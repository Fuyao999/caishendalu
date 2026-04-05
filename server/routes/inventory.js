const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/inventory - 获取背包
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, t.name, t.type, t.rarity, t.description, t.icon, t.use_effect 
       FROM inventory i JOIN items t ON i.item_id=t.id 
       WHERE i.user_id=? ORDER BY i.slot`, [req.user.userId]
    );
    return success(res, rows);
  } catch(err) { next(err); }
});

// POST /api/inventory/use - 使用物品
router.post('/use', authMiddleware, async (req, res, next) => {
  try {
    const { slot } = req.body;
    const [rows] = await pool.query(
      `SELECT i.*, t.use_effect, t.type, t.name FROM inventory i JOIN items t ON i.item_id=t.id 
       WHERE i.user_id=? AND i.slot=?`, [req.user.userId, slot]
    );
    if (rows.length === 0) return fail(res, '该位置没有物品');
    const item = rows[0];
    if (item.type === 'material') return fail(res, '材料无法直接使用');
    // 消耗
    if (item.quantity > 1) {
      await pool.query('UPDATE inventory SET quantity=quantity-1 WHERE id=?', [item.id]);
    } else {
      await pool.query('DELETE FROM inventory WHERE id=?', [item.id]);
    }
    return success(res, { used: item.name, effect: item.use_effect }, `使用了${item.name}`);
  } catch(err) { next(err); }
});

// POST /api/inventory/move-to-sideroom - 移至厢房
router.post('/move-to-sideroom', authMiddleware, async (req, res, next) => {
  try {
    const { inventoryId } = req.body;
    const [inv] = await pool.query('SELECT * FROM inventory WHERE id=? AND user_id=?', [inventoryId, req.user.userId]);
    if (inv.length === 0) return fail(res, '物品不存在');
    // 找厢房空位
    const [srCount] = await pool.query('SELECT COUNT(*) as cnt FROM side_room WHERE user_id=?', [req.user.userId]);
    if (srCount[0].cnt >= 100) return fail(res, '厢房已满');
    const maxSlot = await pool.query('SELECT COALESCE(MAX(slot),-1) as ms FROM side_room WHERE user_id=?', [req.user.userId]);
    const newSlot = maxSlot[0][0].ms + 1;
    await pool.query('INSERT INTO side_room (user_id, item_id, quantity, slot) VALUES (?,?,?,?)',
      [req.user.userId, inv[0].item_id, 1, newSlot]);
    if (inv[0].quantity > 1) {
      await pool.query('UPDATE inventory SET quantity=quantity-1 WHERE id=?', [inventoryId]);
    } else {
      await pool.query('DELETE FROM inventory WHERE id=?', [inventoryId]);
    }
    return success(res, null, '已移至厢房');
  } catch(err) { next(err); }
});

module.exports = router;
