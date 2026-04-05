// ============================================
// 师徒路由 - 拜师/收徒/毕业/奖励
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/mentor - 我的师徒关系
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    // 作为师父
    const [apprentices] = await pool.query(
      `SELECT mr.*, u.username AS apprentice_name, pd.level, pd.realm_name
       FROM mentor_relationships mr
       JOIN users u ON mr.apprentice_id = u.id
       JOIN player_data pd ON mr.apprentice_id = pd.user_id
       WHERE mr.mentor_id = ? AND mr.status = 'active'`,
      [req.userId]
    );
    // 作为徒弟
    const [mentors] = await pool.query(
      `SELECT mr.*, u.username AS mentor_name, pd.level, pd.realm_name
       FROM mentor_relationships mr
       JOIN users u ON mr.mentor_id = u.id
       JOIN player_data pd ON mr.mentor_id = pd.user_id
       WHERE mr.apprentice_id = ? AND mr.status = 'active'`,
      [req.userId]
    );
    return success(res, { apprentices, mentors }, '师徒关系');
  } catch (err) { next(err); }
});

// POST /api/mentor/apprentice - 拜师（我要拜师）
router.post('/apprentice', authMiddleware, async (req, res, next) => {
  try {
    const { mentorId } = req.body;
    if (!mentorId) return fail(res, '请指定师父');
    if (mentorId == req.userId) return fail(res, '不能拜自己为师');

    // 检查师父是否存在
    const [mentor] = await pool.query(
      'SELECT pd.level, pd.realm, u.username FROM player_data pd JOIN users u ON pd.user_id = u.id WHERE pd.user_id = ?',
      [mentorId]
    );
    if (mentor.length === 0) return fail(res, '对方不存在');

    // 师父等级必须比徒弟高20级
    const [me] = await pool.query('SELECT level FROM player_data WHERE user_id = ?', [req.userId]);
    if (mentor[0].level - me[0].level < 20) return fail(res, '师父需要比你高20级以上');

    // 检查是否已有师徒关系
    const [existing] = await pool.query(
      `SELECT id FROM mentor_relationships
       WHERE mentor_id = ? AND apprentice_id = ? AND status = 'active'`,
      [mentorId, req.userId]
    );
    if (existing.length > 0) return fail(res, '已是师徒关系');

    // 一个人最多3个师父
    const [mentorCount] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM mentor_relationships WHERE apprentice_id = ? AND status = 'active'`,
      [req.userId]
    );
    if (mentorCount[0].cnt >= 3) return fail(res, '最多拜3个师父');

    // 师父最多5个徒弟
    const [apprenticeCount] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM mentor_relationships WHERE mentor_id = ? AND status = 'active'`,
      [mentorId]
    );
    if (apprenticeCount[0].cnt >= 5) return fail(res, '对方徒弟已满');

    await pool.query(
      'INSERT INTO mentor_relationships (mentor_id, apprentice_id) VALUES (?,?)',
      [mentorId, req.userId]
    );
    return success(res, null, `拜 ${mentor[0].username} 为师！`);
  } catch (err) { next(err); }
});

// POST /api/mentor/graduate - 出师
router.post('/graduate', authMiddleware, async (req, res, next) => {
  try {
    const { relationId } = req.body;
    if (!relationId) return fail(res, '请指定师徒关系');

    const [rel] = await pool.query(
      `SELECT * FROM mentor_relationships WHERE id = ? AND status = 'active'
       AND (mentor_id = ? OR apprentice_id = ?)`,
      [relationId, req.userId, req.userId]
    );
    if (rel.length === 0) return fail(res, '师徒关系不存在');

    // 徒弟等级达到师父等级的80%才能出师
    const [mentorData] = await pool.query('SELECT level FROM player_data WHERE user_id = ?', [rel[0].mentor_id]);
    const [apprenticeData] = await pool.query('SELECT level FROM player_data WHERE user_id = ?', [rel[0].apprentice_id]);

    if (apprenticeData[0].level < mentorData[0].level * 0.8) {
      return fail(res, `徒弟等级需达到师父等级的80%（当前需 ${Math.ceil(mentorData[0].level * 0.8)} 级）`);
    }

    // 出师奖励
    const mentorReward = 10000;
    const apprenticeBonus = 5000;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE mentor_relationships SET status = 'graduated', graduated_at = NOW(),
         mentor_reward = ?, apprentice_bonus = ? WHERE id = ?`,
        [mentorReward, apprenticeBonus, relationId]
      );
      await conn.query('UPDATE player_data SET gold = gold + ? WHERE user_id = ?', [mentorReward, rel[0].mentor_id]);
      await conn.query('UPDATE player_data SET gold = gold + ? WHERE user_id = ?', [apprenticeBonus, rel[0].apprentice_id]);
      await conn.commit();
      return success(res, { mentorReward, apprenticeBonus }, '出师成功！师徒双方获得奖励！');
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/mentor/dissolve - 解除师徒关系
router.post('/dissolve', authMiddleware, async (req, res, next) => {
  try {
    const { relationId } = req.body;
    if (!relationId) return fail(res, '请指定师徒关系');

    const [rel] = await pool.query(
      `SELECT * FROM mentor_relationships WHERE id = ? AND status = 'active'
       AND (mentor_id = ? OR apprentice_id = ?)`,
      [relationId, req.userId, req.userId]
    );
    if (rel.length === 0) return fail(res, '师徒关系不存在');

    await pool.query(
      `UPDATE mentor_relationships SET status = 'dissolved' WHERE id = ?`, [relationId]
    );
    return success(res, null, '师徒关系已解除');
  } catch (err) { next(err); }
});

module.exports = router;
