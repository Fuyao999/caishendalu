// ============================================
// 装备路由 - 穿戴/卸下/强化/查看
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/equipment - 查看当前装备
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, i.name AS item_name, i.rarity, i.icon, i.equip_stats, i.description
       FROM equipment e
       LEFT JOIN items i ON e.item_id = i.id
       WHERE e.user_id = ?`,
      [req.userId]
    );
    // 转为 slot -> equipment 的 map
    const equipMap = {};
    rows.forEach(r => { equipMap[r.slot] = r; });
    return success(res, equipMap, '装备查询成功');
  } catch (err) { next(err); }
});

// POST /api/equipment/equip - 穿戴装备
router.post('/equip', authMiddleware, async (req, res, next) => {
  try {
    const { inventoryId } = req.body;
    if (!inventoryId) return fail(res, '请指定背包物品');

    // 查背包里的物品
    const [invRows] = await pool.query(
      `SELECT inv.*, i.name, i.type, i.equip_slot, i.equip_stats, i.level_req, i.realm_req
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.id = ? AND inv.user_id = ?`,
      [inventoryId, req.userId]
    );
    if (invRows.length === 0) return fail(res, '物品不存在');

    const item = invRows[0];
    if (item.type !== 'equipment' || !item.equip_slot) {
      return fail(res, '该物品不可装备');
    }

    // 检查等级/境界要求
    const [playerRows] = await pool.query(
      'SELECT level, realm FROM player_data WHERE user_id = ?', [req.userId]
    );
    const player = playerRows[0];
    if (player.level < item.level_req) return fail(res, `需要等级 ${item.level_req}`);
    if (player.realm < item.realm_req) return fail(res, `境界不足`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 查当前该槽位是否已有装备
      const [curEquip] = await conn.query(
        'SELECT * FROM equipment WHERE user_id = ? AND slot = ?',
        [req.userId, item.equip_slot]
      );

      if (curEquip.length > 0 && curEquip[0].item_id) {
        // 旧装备放回背包
        const [freeSlot] = await conn.query(
          'SELECT COALESCE(MAX(slot),0)+1 AS next_slot FROM inventory WHERE user_id = ?',
          [req.userId]
        );
        await conn.query(
          'INSERT INTO inventory (user_id, item_id, quantity, slot) VALUES (?,?,1,?)',
          [req.userId, curEquip[0].item_id, freeSlot[0].next_slot]
        );
      }

      // 更新/插入装备槽
      await conn.query(
        `INSERT INTO equipment (user_id, slot, item_id, enhance_level)
         VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE item_id = VALUES(item_id), enhance_level = 0`,
        [req.userId, item.equip_slot, item.item_id]
      );

      // 从背包移除
      await conn.query('DELETE FROM inventory WHERE id = ?', [inventoryId]);

      await conn.commit();
      return success(res, { slot: item.equip_slot, itemName: item.name }, '装备穿戴成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// POST /api/equipment/unequip - 卸下装备
router.post('/unequip', authMiddleware, async (req, res, next) => {
  try {
    const { slot } = req.body;
    if (!slot) return fail(res, '请指定装备槽位');

    const [equip] = await pool.query(
      'SELECT * FROM equipment WHERE user_id = ? AND slot = ?',
      [req.userId, slot]
    );
    if (equip.length === 0 || !equip[0].item_id) {
      return fail(res, '该槽位没有装备');
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 检查背包空间 (100格上限)
      const [countRows] = await conn.query(
        'SELECT COUNT(*) AS cnt FROM inventory WHERE user_id = ?', [req.userId]
      );
      if (countRows[0].cnt >= 100) {
        await conn.rollback();
        return fail(res, '背包已满，无法卸下');
      }

      // 放入背包
      const [freeSlot] = await conn.query(
        'SELECT COALESCE(MAX(slot),0)+1 AS next_slot FROM inventory WHERE user_id = ?',
        [req.userId]
      );
      await conn.query(
        'INSERT INTO inventory (user_id, item_id, quantity, slot) VALUES (?,?,1,?)',
        [req.userId, equip[0].item_id, freeSlot[0].next_slot]
      );

      // 清空装备槽
      await conn.query(
        'UPDATE equipment SET item_id = NULL, enhance_level = 0, enchant = NULL, gems = NULL WHERE user_id = ? AND slot = ?',
        [req.userId, slot]
      );

      await conn.commit();
      return success(res, { slot }, '装备卸下成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

// POST /api/equipment/enhance - 强化装备
router.post('/enhance', authMiddleware, async (req, res, next) => {
  try {
    const { slot } = req.body;
    if (!slot) return fail(res, '请指定装备槽位');

    const [equip] = await pool.query(
      'SELECT * FROM equipment WHERE user_id = ? AND slot = ?',
      [req.userId, slot]
    );
    if (equip.length === 0 || !equip[0].item_id) {
      return fail(res, '该槽位没有装备');
    }

    const curLevel = equip[0].enhance_level;
    const maxLevel = 15;
    if (curLevel >= maxLevel) return fail(res, '已达最大强化等级');

    // 强化费用: 等级 * 1000 金币
    const cost = (curLevel + 1) * 1000;
    const [player] = await pool.query(
      'SELECT gold FROM player_data WHERE user_id = ?', [req.userId]
    );
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost} 金币`);

    // 成功率: 100% - 等级*5% (最低30%)
    const rate = Math.max(0.3, 1 - curLevel * 0.05);
    const isSuccess = Math.random() < rate;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 扣金币
      await conn.query(
        'UPDATE player_data SET gold = gold - ? WHERE user_id = ?',
        [cost, req.userId]
      );

      if (isSuccess) {
        await conn.query(
          'UPDATE equipment SET enhance_level = enhance_level + 1 WHERE user_id = ? AND slot = ?',
          [req.userId, slot]
        );
      }

      await conn.commit();
      return success(res, {
        success: isSuccess,
        newLevel: isSuccess ? curLevel + 1 : curLevel,
        cost,
        rate: Math.round(rate * 100) + '%'
      }, isSuccess ? '强化成功！' : '强化失败，装备未损坏');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

module.exports = router;
