// ============================================
// 商城路由 - 商品列表/购买/出售
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/shop - 商品列表
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { type, rarity, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE buy_price > 0';
    const params = [];

    if (type) { where += ' AND type = ?'; params.push(type); }
    if (rarity) { where += ' AND rarity = ?'; params.push(parseInt(rarity)); }

    const [rows] = await pool.query(
      `SELECT id, name, type, sub_type, rarity, description, icon, buy_price, sell_price, level_req, realm_req
       FROM items ${where} ORDER BY rarity DESC, buy_price ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [total] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM items ${where}`, params
    );

    return success(res, { items: rows, total: total[0].cnt, page: parseInt(page) }, '商品列表');
  } catch (err) { next(err); }
});

// POST /api/shop/buy - 购买商品
router.post('/buy', authMiddleware, async (req, res, next) => {
  try {
    const { itemId, quantity } = req.body;
    if (!itemId) return fail(res, '请指定商品');
    const qty = quantity || 1;
    if (qty < 1 || qty > 99) return fail(res, '数量1-99');

    // 查商品
    const [itemRows] = await pool.query(
      'SELECT * FROM items WHERE id = ? AND buy_price > 0', [itemId]
    );
    if (itemRows.length === 0) return fail(res, '商品不存在或不可购买');
    const item = itemRows[0];

    // 检查等级/境界
    const [playerRows] = await pool.query(
      'SELECT level, realm, gold, yuanbao FROM player_data WHERE user_id = ?',
      [req.userId]
    );
    const player = playerRows[0];
    if (player.level < item.level_req) return fail(res, `需要等级 ${item.level_req}`);
    if (player.realm < item.realm_req) return fail(res, '境界不足');

    const totalCost = item.buy_price * qty;
    if (player.gold < totalCost) return fail(res, `金币不足，需要 ${totalCost}`);

    // 检查背包空间
    const [invCount] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM inventory WHERE user_id = ?', [req.userId]
    );
    if (invCount[0].cnt >= 100) return fail(res, '背包已满');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 扣金币
      await conn.query(
        'UPDATE player_data SET gold = gold - ? WHERE user_id = ?',
        [totalCost, req.userId]
      );

      // 检查是否已有同类物品（可叠加）
      if (item.stackable) {
        const [existing] = await conn.query(
          'SELECT id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
          [req.userId, itemId]
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
            [req.userId, itemId, qty, maxSlot[0].next_slot]
          );
        }
      } else {
        // 不可叠加的物品每个占一格
        for (let i = 0; i < qty; i++) {
          const [maxSlot] = await conn.query(
            'SELECT COALESCE(MAX(slot),0)+1 AS next_slot FROM inventory WHERE user_id = ?',
            [req.userId]
          );
          await conn.query(
            'INSERT INTO inventory (user_id, item_id, quantity, slot) VALUES (?,?,1,?)',
            [req.userId, itemId, maxSlot[0].next_slot]
          );
        }
      }

      // 记日志
      await conn.query(
        'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
        [req.userId, 'shop_buy', JSON.stringify({ itemId, qty, cost: totalCost })]
      );

      await conn.commit();
      return success(res, {
        itemName: item.name,
        quantity: qty,
        cost: totalCost,
        remainGold: player.gold - totalCost
      }, `购买成功：${item.name} x${qty}`);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// POST /api/shop/sell - 出售物品
router.post('/sell', authMiddleware, async (req, res, next) => {
  try {
    const { inventoryId, quantity } = req.body;
    if (!inventoryId) return fail(res, '请指定背包物品');
    const qty = quantity || 1;

    const [invRows] = await pool.query(
      `SELECT inv.*, i.name, i.sell_price, i.tradeable
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = ? AND inv.user_id = ?`,
      [inventoryId, req.userId]
    );
    if (invRows.length === 0) return fail(res, '物品不存在');
    const inv = invRows[0];
    if (inv.sell_price <= 0) return fail(res, '该物品不可出售');
    if (inv.quantity < qty) return fail(res, '数量不足');
    if (inv.is_locked) return fail(res, '物品已锁定');

    const totalGold = inv.sell_price * qty;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 加金币
      await conn.query(
        'UPDATE player_data SET gold = gold + ? WHERE user_id = ?',
        [totalGold, req.userId]
      );

      // 减少/删除物品
      if (inv.quantity <= qty) {
        await conn.query('DELETE FROM inventory WHERE id = ?', [inventoryId]);
      } else {
        await conn.query(
          'UPDATE inventory SET quantity = quantity - ? WHERE id = ?',
          [qty, inventoryId]
        );
      }

      await conn.commit();
      return success(res, {
        itemName: inv.name,
        quantity: qty,
        earned: totalGold
      }, `出售成功：获得 ${totalGold} 金币`);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

module.exports = router;
