// ============================================
// 技能路由 - 学习/升级/装备/查看
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/skills - 可学技能列表
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { type } = req.query;
    let where = '1=1';
    const params = [];
    if (type) { where += ' AND type = ?'; params.push(type); }

    const [rows] = await pool.query(
      `SELECT * FROM skills WHERE ${where} ORDER BY level_req, realm_req`, params
    );
    return success(res, rows, '技能列表');
  } catch (err) { next(err); }
});

// GET /api/skills/my - 已学技能
router.get('/my', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT ps.*, s.name, s.type, s.element, s.description, s.icon,
              s.base_damage, s.mp_cost, s.cooldown_sec, s.max_level, s.effect
       FROM player_skills ps JOIN skills s ON ps.skill_id = s.id
       WHERE ps.user_id = ? ORDER BY ps.equipped DESC, ps.slot`,
      [req.userId]
    );
    return success(res, rows, '已学技能');
  } catch (err) { next(err); }
});

// POST /api/skills/learn - 学习技能
router.post('/learn', authMiddleware, async (req, res, next) => {
  try {
    const { skillId } = req.body;
    if (!skillId) return fail(res, '请指定技能');

    const [skillRows] = await pool.query('SELECT * FROM skills WHERE id = ?', [skillId]);
    if (skillRows.length === 0) return fail(res, '技能不存在');
    const skill = skillRows[0];

    // 检查是否已学
    const [learned] = await pool.query(
      'SELECT id FROM player_skills WHERE user_id = ? AND skill_id = ?',
      [req.userId, skillId]
    );
    if (learned.length > 0) return fail(res, '已学会该技能');

    // 检查等级/境界
    const [player] = await pool.query(
      'SELECT level, realm, gold FROM player_data WHERE user_id = ?', [req.userId]
    );
    const p = player[0];
    if (p.level < skill.level_req) return fail(res, `需要等级 ${skill.level_req}`);
    if (p.realm < skill.realm_req) return fail(res, '境界不足');

    // 学习费用: 技能等级要求 * 500
    const cost = skill.level_req * 500;
    if (p.gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      await conn.query(
        'INSERT INTO player_skills (user_id, skill_id, level) VALUES (?, ?, 1)',
        [req.userId, skillId]
      );
      await conn.commit();
      return success(res, { skillName: skill.name, cost }, `学会了「${skill.name}」！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/skills/upgrade - 升级技能
router.post('/upgrade', authMiddleware, async (req, res, next) => {
  try {
    const { skillId } = req.body;
    if (!skillId) return fail(res, '请指定技能');

    const [ps] = await pool.query(
      `SELECT ps.*, s.max_level, s.name FROM player_skills ps
       JOIN skills s ON ps.skill_id = s.id
       WHERE ps.user_id = ? AND ps.skill_id = ?`,
      [req.userId, skillId]
    );
    if (ps.length === 0) return fail(res, '未学会该技能');
    if (ps[0].level >= ps[0].max_level) return fail(res, '已满级');

    const cost = ps[0].level * 1000;
    const [player] = await pool.query('SELECT gold FROM player_data WHERE user_id = ?', [req.userId]);
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      await conn.query('UPDATE player_skills SET level = level + 1 WHERE id = ?', [ps[0].id]);
      await conn.commit();
      return success(res, { skillName: ps[0].name, newLevel: ps[0].level + 1, cost }, '技能升级成功！');
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/skills/equip - 装备/卸下技能到技能栏
router.post('/equip', authMiddleware, async (req, res, next) => {
  try {
    const { skillId, slot, unequip } = req.body;
    if (!skillId) return fail(res, '请指定技能');

    const [ps] = await pool.query(
      'SELECT * FROM player_skills WHERE user_id = ? AND skill_id = ?',
      [req.userId, skillId]
    );
    if (ps.length === 0) return fail(res, '未学会该技能');

    if (unequip) {
      await pool.query(
        'UPDATE player_skills SET equipped = 0, slot = NULL WHERE id = ?', [ps[0].id]
      );
      return success(res, null, '技能已卸下');
    }

    // 最多装备6个技能
    const [equipped] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM player_skills WHERE user_id = ? AND equipped = 1',
      [req.userId]
    );
    if (equipped[0].cnt >= 6 && !ps[0].equipped) {
      return fail(res, '技能栏已满（最多6个）');
    }

    await pool.query(
      'UPDATE player_skills SET equipped = 1, slot = ? WHERE id = ?',
      [slot || equipped[0].cnt + 1, ps[0].id]
    );
    return success(res, null, '技能已装备');
  } catch (err) { next(err); }
});

module.exports = router;

// POST /api/skills/create - 创建技能定义（管理员）
router.post('/create-skill', authMiddleware, async (req, res, next) => {
  try {
    if (req.userId !== 1) return fail(res, '无管理员权限', 403);
    const { name, type, element, description, icon, base_damage, mp_cost, cooldown_sec, max_level, level_req, realm_req, effect } = req.body;
    if (!name || !type) return fail(res, '名称和类型必填');
    const [result] = await pool.query(
      'INSERT INTO skills (name, type, element, description, icon, base_damage, mp_cost, cooldown_sec, max_level, level_req, realm_req, effect) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [name, type, element, description, icon||'⚡', base_damage||10, mp_cost||5, cooldown_sec||3, max_level||10, level_req||1, realm_req||1, effect]
    );
    return success(res, { id: result.insertId }, '技能创建成功');
  } catch (err) { next(err); }
});
