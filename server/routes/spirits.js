// ============================================
// 精怪契约路由 - 契约/升级/激活
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/spirits - 我的精怪契约
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM spirit_contracts WHERE user_id = ? ORDER BY is_active DESC, level DESC',
      [req.userId]
    );
    return success(res, rows, '精怪契约列表');
  } catch (err) { next(err); }
});

// POST /api/spirits/contract - 签订契约
router.post('/contract', authMiddleware, async (req, res, next) => {
  try {
    const cost = 8000;
    const [player] = await pool.query(
      'SELECT gold, level FROM player_data WHERE user_id = ?', [req.userId]
    );
    if (player[0].level < 15) return fail(res, '15级后才能签订精怪契约');
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    // 最多5个契约
    const [count] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM spirit_contracts WHERE user_id = ?', [req.userId]
    );
    if (count[0].cnt >= 5) return fail(res, '契约数量已满（最多5个）');

    const spiritPool = [
      { type: '山精', name: '石灵童子', skill: '山岳之力' },
      { type: '水怪', name: '碧波仙子', skill: '潮汐护佑' },
      { type: '花妖', name: '百花灵', skill: '花雨缤纷' },
      { type: '树精', name: '千年古木', skill: '根脉相连' },
      { type: '狐仙', name: '青丘白狐', skill: '幻影迷踪' },
      { type: '龙子', name: '小青龙', skill: '龙息术' },
      { type: '凤雏', name: '火凤雏', skill: '涅槃之焰' },
      { type: '玉兔', name: '月宫玉兔', skill: '月华术' },
    ];

    const spirit = spiritPool[Math.floor(Math.random() * spiritPool.length)];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      const [result] = await conn.query(
        'INSERT INTO spirit_contracts (user_id, spirit_type, spirit_name, skill) VALUES (?,?,?,?)',
        [req.userId, spirit.type, spirit.name, spirit.skill]
      );
      await conn.commit();
      return success(res, { contractId: result.insertId, ...spirit }, `与「${spirit.name}」签订契约！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/spirits/activate - 激活/解除契约精怪
router.post('/activate', authMiddleware, async (req, res, next) => {
  try {
    const { contractId } = req.body;
    if (!contractId) return fail(res, '请指定契约');

    const [spirit] = await pool.query(
      'SELECT * FROM spirit_contracts WHERE id = ? AND user_id = ?', [contractId, req.userId]
    );
    if (spirit.length === 0) return fail(res, '契约不存在');

    if (spirit[0].is_active) {
      await pool.query('UPDATE spirit_contracts SET is_active = 0 WHERE id = ?', [contractId]);
      return success(res, null, `${spirit[0].spirit_name} 已解除激活`);
    }

    // 最多同时激活2个
    const [activeCount] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM spirit_contracts WHERE user_id = ? AND is_active = 1', [req.userId]
    );
    if (activeCount[0].cnt >= 2) return fail(res, '最多同时激活2个精怪');

    await pool.query('UPDATE spirit_contracts SET is_active = 1 WHERE id = ?', [contractId]);
    return success(res, null, `${spirit[0].spirit_name} 已激活！技能：${spirit[0].skill}`);
  } catch (err) { next(err); }
});

// POST /api/spirits/upgrade - 提升羁绊
router.post('/upgrade', authMiddleware, async (req, res, next) => {
  try {
    const { contractId } = req.body;
    if (!contractId) return fail(res, '请指定契约');

    const [spirit] = await pool.query(
      'SELECT * FROM spirit_contracts WHERE id = ? AND user_id = ?', [contractId, req.userId]
    );
    if (spirit.length === 0) return fail(res, '契约不存在');
    if (spirit[0].level >= 20) return fail(res, '已达最大等级');

    const cost = spirit[0].level * 800;
    const [player] = await pool.query('SELECT gold FROM player_data WHERE user_id = ?', [req.userId]);
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      await conn.query(
        'UPDATE spirit_contracts SET level = level + 1, bond = bond + 50 WHERE id = ?', [contractId]
      );
      await conn.commit();
      return success(res, { newLevel: spirit[0].level + 1, cost }, `${spirit[0].spirit_name} 羁绊提升！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
