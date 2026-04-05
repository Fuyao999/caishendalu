// ============================================
// 坐骑路由 - 查看/获取/激活/升级
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/mounts - 我的坐骑列表
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM mounts WHERE user_id = ? ORDER BY is_active DESC, level DESC',
      [req.userId]
    );
    return success(res, rows, '坐骑列表');
  } catch (err) { next(err); }
});

// POST /api/mounts/obtain - 获取坐骑
router.post('/obtain', authMiddleware, async (req, res, next) => {
  try {
    const cost = 10000;
    const [player] = await pool.query(
      'SELECT gold, level FROM player_data WHERE user_id = ?', [req.userId]
    );
    if (player[0].level < 10) return fail(res, '10级后才能获取坐骑');
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    const mountPool = [
      { type: '祥云', speed: 10, levelReq: 10 },
      { type: '仙鹤', speed: 15, levelReq: 20 },
      { type: '麒麟坐骑', speed: 25, levelReq: 40 },
      { type: '金翅大鹏', speed: 30, levelReq: 50 },
      { type: '九龙御辇', speed: 50, levelReq: 70 },
    ];

    const available = mountPool.filter(m => player[0].level >= m.levelReq);
    const mount = available[Math.floor(Math.random() * available.length)];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      const [result] = await conn.query(
        'INSERT INTO mounts (user_id, mount_type, name, speed_bonus) VALUES (?,?,?,?)',
        [req.userId, mount.type, mount.type, mount.speed]
      );
      await conn.commit();
      return success(res, { mountId: result.insertId, ...mount }, `获得坐骑：${mount.type}！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/mounts/activate - 骑乘/下坐骑
router.post('/activate', authMiddleware, async (req, res, next) => {
  try {
    const { mountId } = req.body;
    if (!mountId) return fail(res, '请指定坐骑');

    const [mount] = await pool.query(
      'SELECT * FROM mounts WHERE id = ? AND user_id = ?', [mountId, req.userId]
    );
    if (mount.length === 0) return fail(res, '坐骑不存在');

    if (mount[0].is_active) {
      await pool.query('UPDATE mounts SET is_active = 0 WHERE id = ?', [mountId]);
      return success(res, null, `下了 ${mount[0].name}`);
    }

    await pool.query('UPDATE mounts SET is_active = 0 WHERE user_id = ? AND is_active = 1', [req.userId]);
    await pool.query('UPDATE mounts SET is_active = 1 WHERE id = ?', [mountId]);
    return success(res, null, `骑上了 ${mount[0].name}！速度+${mount[0].speed_bonus}`);
  } catch (err) { next(err); }
});

// POST /api/mounts/upgrade - 升级坐骑
router.post('/upgrade', authMiddleware, async (req, res, next) => {
  try {
    const { mountId } = req.body;
    if (!mountId) return fail(res, '请指定坐骑');

    const [mount] = await pool.query(
      'SELECT * FROM mounts WHERE id = ? AND user_id = ?', [mountId, req.userId]
    );
    if (mount.length === 0) return fail(res, '坐骑不存在');
    if (mount[0].level >= 30) return fail(res, '已达最大等级');

    const cost = mount[0].level * 500;
    const [player] = await pool.query('SELECT gold FROM player_data WHERE user_id = ?', [req.userId]);
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      await conn.query(
        'UPDATE mounts SET level = level + 1, speed_bonus = speed_bonus + 2 WHERE id = ?', [mountId]
      );
      await conn.commit();
      return success(res, { newLevel: mount[0].level + 1, cost }, `${mount[0].name} 升级了！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
