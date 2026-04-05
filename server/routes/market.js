// ============================================
// 交易市场路由 - 摆摊/上架/购买/管理
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/market - 市场商品浏览
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { itemName, type, rarity, sortBy = 'price', order = 'ASC', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = "WHERE si.status = 'selling'";
    const params = [];

    if (itemName) { where += ' AND i.name LIKE ?'; params.push(`%${itemName}%`); }
    if (type) { where += ' AND i.type = ?'; params.push(type); }
    if (rarity) { where += ' AND i.rarity = ?'; params.push(parseInt(rarity)); }

    const validSort = ['price', 'rarity', 'listed_at'].includes(sortBy) ? sortBy : 'price';
    const validOrder = order === 'DESC' ? 'DESC' : 'ASC';

    const [rows] = await pool.query(
      `SELECT si.id, si.quantity, si.price, si.listed_at,
              i.name AS item_name, i.type, i.rarity, i.icon, i.description,
              u.username AS seller_name, s.stall_name
       FROM stall_items si
       JOIN items i ON si.item_id = i.id
       JOIN stalls s ON si.stall_id = s.id
       JOIN users u ON si.seller_id = u.id
       ${where} ORDER BY ${validSort === 'rarity' ? 'i.rarity' : 'si.' + validSort} ${validOrder}
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [total] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM stall_items si JOIN items i ON si.item_id = i.id ${where}`, params
    );

    return success(res, { items: rows, total: total[0].cnt, page: parseInt(page) }, '市场商品');
  } catch (err) { next(err); }
});

// GET /api/market/my-stall - 我的摊位
router.get('/my-stall', authMiddleware, async (req, res, next) => {
  try {
    const [stall] = await pool.query('SELECT * FROM stalls WHERE user_id = ?', [req.userId]);
    if (stall.length === 0) return success(res, null, '未开设摊位');

    const [items] = await pool.query(
      `SELECT si.*, i.name AS item_name, i.rarity, i.icon
       FROM stall_items si JOIN items i ON si.item_id = i.id
       WHERE si.stall_id = ? AND si.status = 'selling'`,
      [stall[0].id]
    );
    return success(res, { stall: stall[0], items }, '我的摊位');
  } catch (err) { next(err); }
});

// POST /api/market/open-stall - 开设摊位
router.post('/open-stall', authMiddleware, async (req, res, next) => {
  try {
    const { stallName } = req.body;
    const [existing] = await pool.query('SELECT id FROM stalls WHERE user_id = ?', [req.userId]);
    if (existing.length > 0) return fail(res, '已有摊位');

    const [player] = await pool.query('SELECT level FROM player_data WHERE user_id = ?', [req.userId]);
    if (player[0].level < 10) return fail(res, '10级后才能开摊');

    const [result] = await pool.query(
      'INSERT INTO stalls (user_id, stall_name) VALUES (?,?)',
      [req.userId, stallName || '无名摊位']
    );
    return success(res, { stallId: result.insertId }, '摊位开设成功！');
  } catch (err) { next(err); }
});

// POST /api/market/list - 上架商品
router.post('/list', authMiddleware, async (req, res, next) => {
  try {
    const { inventoryId, price, quantity } = req.body;
    if (!inventoryId || !price) return fail(res, '请指定物品和价格');
    if (price < 1) return fail(res, '价格不能小于1');
    const qty = quantity || 1;

    const [stall] = await pool.query('SELECT * FROM stalls WHERE user_id = ?', [req.userId]);
    if (stall.length === 0) return fail(res, '请先开设摊位');

    // 检查摊位容量
    const [listed] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM stall_items WHERE stall_id = ? AND status = 'selling'",
      [stall[0].id]
    );
    if (listed[0].cnt >= stall[0].max_items) return fail(res, '摊位已满');

    // 检查背包物品
    const [inv] = await pool.query(
      `SELECT inv.*, i.name, i.tradeable FROM inventory inv
       JOIN items i ON inv.item_id = i.id
       WHERE inv.id = ? AND inv.user_id = ?`,
      [inventoryId, req.userId]
    );
    if (inv.length === 0) return fail(res, '物品不存在');
    if (!inv[0].tradeable) return fail(res, '该物品不可交易');
    if (inv[0].quantity < qty) return fail(res, '数量不足');
    if (inv[0].is_locked) return fail(res, '物品已锁定');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 从背包移除
      if (inv[0].quantity <= qty) {
        await conn.query('DELETE FROM inventory WHERE id = ?', [inventoryId]);
      } else {
        await conn.query('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [qty, inventoryId]);
      }

      // 上架
      await conn.query(
        'INSERT INTO stall_items (stall_id, seller_id, item_id, quantity, price) VALUES (?,?,?,?,?)',
        [stall[0].id, req.userId, inv[0].item_id, qty, price]
      );

      await conn.commit();
      return success(res, { itemName: inv[0].name, price, quantity: qty }, `${inv[0].name} 已上架！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/market/buy - 购买商品
router.post('/buy', authMiddleware, async (req, res, next) => {
  try {
    const { listingId } = req.body;
    if (!listingId) return fail(res, '请指定商品');

    const [listing] = await pool.query(
      `SELECT si.*, i.name AS item_name FROM stall_items si
       JOIN items i ON si.item_id = i.id
       WHERE si.id = ? AND si.status = 'selling'`,
      [listingId]
    );
    if (listing.length === 0) return fail(res, '商品不存在或已售出');
    if (listing[0].seller_id == req.userId) return fail(res, '不能买自己的商品');

    const item = listing[0];
    const [player] = await pool.query('SELECT gold FROM player_data WHERE user_id = ?', [req.userId]);
    if (player[0].gold < item.price) return fail(res, '金币不足');

    const tax = Math.floor(item.price * 0.05); // 5%交易税
    const sellerGain = item.price - tax;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 买家扣金币
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [item.price, req.userId]);
      // 卖家加金币（扣税）
      await conn.query('UPDATE player_data SET gold = gold + ? WHERE user_id = ?', [sellerGain, item.seller_id]);

      // 物品给买家
      const [existing] = await conn.query(
        'SELECT id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
        [req.userId, item.item_id]
      );
      if (existing.length > 0) {
        await conn.query('UPDATE inventory SET quantity = quantity + ? WHERE id = ?', [item.quantity, existing[0].id]);
      } else {
        const [maxSlot] = await conn.query(
          'SELECT COALESCE(MAX(slot),0)+1 AS ns FROM inventory WHERE user_id = ?', [req.userId]
        );
        await conn.query(
          'INSERT INTO inventory (user_id, item_id, quantity, slot) VALUES (?,?,?,?)',
          [req.userId, item.item_id, item.quantity, maxSlot[0].ns]
        );
      }

      // 更新上架状态
      await conn.query(
        "UPDATE stall_items SET status = 'sold', buyer_id = ?, sold_at = NOW() WHERE id = ?",
        [req.userId, listingId]
      );

      // 日志
      await conn.query(
        'INSERT INTO logs (user_id, action, detail) VALUES (?,?,?)',
        [req.userId, 'market_buy', JSON.stringify({ listingId, itemName: item.item_name, price: item.price, tax })]
      );

      await conn.commit();
      return success(res, {
        itemName: item.item_name,
        price: item.price,
        tax,
        sellerGain
      }, `购买成功：${item.item_name}！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/market/cancel - 下架商品
router.post('/cancel', authMiddleware, async (req, res, next) => {
  try {
    const { listingId } = req.body;
    if (!listingId) return fail(res, '请指定商品');

    const [listing] = await pool.query(
      "SELECT * FROM stall_items WHERE id = ? AND seller_id = ? AND status = 'selling'",
      [listingId, req.userId]
    );
    if (listing.length === 0) return fail(res, '商品不存在');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 退回背包
      const [existing] = await conn.query(
        'SELECT id, quantity FROM inventory WHERE user_id = ? AND item_id = ?',
        [req.userId, listing[0].item_id]
      );
      if (existing.length > 0) {
        await conn.query('UPDATE inventory SET quantity = quantity + ? WHERE id = ?', [listing[0].quantity, existing[0].id]);
      } else {
        const [maxSlot] = await conn.query(
          'SELECT COALESCE(MAX(slot),0)+1 AS ns FROM inventory WHERE user_id = ?', [req.userId]
        );
        await conn.query(
          'INSERT INTO inventory (user_id, item_id, quantity, slot) VALUES (?,?,?,?)',
          [req.userId, listing[0].item_id, listing[0].quantity, maxSlot[0].ns]
        );
      }

      await conn.query("UPDATE stall_items SET status = 'cancelled' WHERE id = ?", [listingId]);
      await conn.commit();
      return success(res, null, '商品已下架，物品退回背包');
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
