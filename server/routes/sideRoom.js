// ============================================
// 厢房(仓库)路由 - 存取物品/升级
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/sideroom - 查看厢房物品
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT sr.*, i.name, i.type, i.rarity, i.icon, i.description
       FROM side_room sr JOIN items i ON sr.item_id = i.id
       WHERE sr.user_id = ? ORDER BY sr.slot`,
      [req.userId]
    );
    // 查厢房容量
    const [player] = await pool.query(
      'SELECT temple_level, temple_storage FROM player_data WHERE user_id = ?',
      [req.userId]
    );
    const capacity = 20 + (player[0]?.temple_level || 1) * 10; // 基础20格 + 庙宇等级*10
    return success(res, { items: rows, capacity, used: rows.length }, '厢房查询成功');
  } catch (err) { next(err); }
});

// POST /api/sideroom/store - 从背包存入厢房
router.post('/store', authMiddleware, async (req, res, next) => {
  try {
    const { inventoryId, quantity } = req.body;
    if (!inventoryId) return fail(res, '请指定背包物品');
    const qty = quantity || 1;

    const [invRows] = await pool.query(
      'SELECT * FROM inventory WHERE id = ? AND user_id = ?',
      [inventoryId, req.userId]
    );
    if (invRows.length === 0) return fail(res, '物品不存在');
    if (invRows[0].quantity < qty) return fail(res, '数量不足');

    // 检查厢房容量
    const [player] = await pool.query(
      'SELECT temple_level FROM player_data WHERE user_id = ?', [req.userId]
    );
    const capacity = 20 + (player[0]?.temple_level || 1) * 10;
    const [srCount] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM side_room WHERE user_id = ?', [req.userId]
    );
    if (srCount[0].cnt >= capacity) return fail(res, '厢房已满');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 检查厢房是否已有同类物品（可叠加）
      const [existing] = await conn.query(
        'SELECT id, quantity FROM side_room WHERE user_id = ? AND item_id = ?',
        [req.userId, invRows[0].item_id]
      );

      if (existing.length > 0) {
        await conn.query(
          'UPDATE side_room SET quantity = quantity + ? WHERE id = ?',
          [qty, existing[0].id]
        );
      } else {
        const [maxSlot] = await conn.query(
          'SELECT COALESCE(MAX(slot),0)+1 AS next_slot FROM side_room WHERE user_id = ?',
          [req.userId]
        );
        await conn.query(
          'INSERT INTO side_room (user_id, item_id, quantity, slot) VALUES (?,?,?,?)',
          [req.userId, invRows[0].item_id, qty, maxSlot[0].next_slot]
        );
      }

      // 更新/删除背包物品
      if (invRows[0].quantity <= qty) {
        await conn.query('DELETE FROM inventory WHERE id = ?', [inventoryId]);
      } else {
        await conn.query(
          'UPDATE inventory SET quantity = quantity - ? WHERE id = ?',
          [qty, inventoryId]
        );
      }

      await conn.commit();
      return success(res, { stored: qty }, '存入厢房成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// POST /api/sideroom/retrieve - 从厢房取出到背包
router.post('/retrieve', authMiddleware, async (req, res, next) => {
  try {
    const { sideRoomId, quantity } = req.body;
    if (!sideRoomId) return fail(res, '请指定厢房物品');
    const qty = quantity || 1;

    const [srRows] = await pool.query(
      'SELECT * FROM side_room WHERE id = ? AND user_id = ?',
      [sideRoomId, req.userId]
    );
    if (srRows.length === 0) return fail(res, '物品不存在');
    if (srRows[0].quantity < qty) return fail(res, '数量不足');

    // 检查背包空间
    const [invCount] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM inventory WHERE user_id = ?', [req.userId]
    );
    if (invCount[0].cnt >= 100) return fail(res, '背包已满');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 检查背包是否有同类物品
      const [existing] = await conn.query(
        'SELECT id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
        [req.userId, srRows[0].item_id]
      );

      if (existing.length > 0) {
        await conn.query(
          'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
          [qty, existing[0].id]
        );
      } else {
        const [maxSlot] = await conn.query(
          'SELECT COALESCE(MAX(slot),0)+1 AS next_slot FROM inventory WHERE user_id = ?',
          [req.userId]
        );
        await conn.query(
          'INSERT INTO inventory (user_id, item_id, quantity, slot) VALUES (?,?,?,?)',
          [req.userId, srRows[0].item_id, qty, maxSlot[0].next_slot]
        );
      }

      // 更新/删除厢房物品
      if (srRows[0].quantity <= qty) {
        await conn.query('DELETE FROM side_room WHERE id = ?', [sideRoomId]);
      } else {
        await conn.query(
          'UPDATE side_room SET quantity = quantity - ? WHERE id = ?',
          [qty, sideRoomId]
        );
      }

      await conn.commit();
      return success(res, { retrieved: qty }, '取出成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

module.exports = router;
