// ============================================
// 门派路由 - 创建/加入/退出/捐献/管理
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/sects - 门派列表
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const [rows] = await pool.query(
      `SELECT s.*, u.username AS leader_name
       FROM sects s LEFT JOIN users u ON s.leader_id = u.id
       ORDER BY s.level DESC, s.member_count DESC LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );
    return success(res, rows, '门派列表');
  } catch (err) { next(err); }
});

// GET /api/sects/my - 我的门派
router.get('/my', authMiddleware, async (req, res, next) => {
  try {
    const [ps] = await pool.query(
      `SELECT ps.*, s.name, s.level, s.exp, s.funds, s.member_count, s.max_members,
              s.announcement, s.icon, u.username AS leader_name
       FROM player_sect ps
       JOIN sects s ON ps.sect_id = s.id
       LEFT JOIN users u ON s.leader_id = u.id
       WHERE ps.user_id = ?`,
      [req.userId]
    );
    if (ps.length === 0) return success(res, null, '未加入门派');

    // 查门派成员
    const [members] = await pool.query(
      `SELECT ps.role, ps.contribution, ps.joined_at, u.username,
              pd.level, pd.realm_name
       FROM player_sect ps
       JOIN users u ON ps.user_id = u.id
       JOIN player_data pd ON ps.user_id = pd.user_id
       WHERE ps.sect_id = ? ORDER BY ps.role DESC, ps.contribution DESC`,
      [ps[0].sect_id]
    );

    return success(res, { ...ps[0], members }, '门派详情');
  } catch (err) { next(err); }
});

// POST /api/sects/create - 创建门派
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name || name.length < 2 || name.length > 16) return fail(res, '门派名2-16个字符');

    // 检查是否已有门派
    const [existing] = await pool.query(
      'SELECT id FROM player_sect WHERE user_id = ?', [req.userId]
    );
    if (existing.length > 0) return fail(res, '已有门派，请先退出');

    // 检查名字重复
    const [dup] = await pool.query('SELECT id FROM sects WHERE name = ?', [name]);
    if (dup.length > 0) return fail(res, '门派名已被使用');

    // 创建费用 50000 金币
    const cost = 50000;
    const [player] = await pool.query('SELECT gold, level FROM player_data WHERE user_id = ?', [req.userId]);
    if (player[0].level < 20) return fail(res, '20级后才能创建门派');
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      const [result] = await conn.query(
        'INSERT INTO sects (name, leader_id, description, member_count) VALUES (?,?,?,1)',
        [name, req.userId, description || '']
      );
      await conn.query(
        'INSERT INTO player_sect (user_id, sect_id, role) VALUES (?,?,?)',
        [req.userId, result.insertId, 'leader']
      );
      await conn.commit();
      return success(res, { sectId: result.insertId, name }, `门派「${name}」创建成功！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/sects/join - 加入门派
router.post('/join', authMiddleware, async (req, res, next) => {
  try {
    const { sectId } = req.body;
    if (!sectId) return fail(res, '请指定门派');

    const [existing] = await pool.query('SELECT id FROM player_sect WHERE user_id = ?', [req.userId]);
    if (existing.length > 0) return fail(res, '已有门派，请先退出');

    const [sect] = await pool.query('SELECT * FROM sects WHERE id = ?', [sectId]);
    if (sect.length === 0) return fail(res, '门派不存在');
    if (sect[0].member_count >= sect[0].max_members) return fail(res, '门派已满');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        'INSERT INTO player_sect (user_id, sect_id, role) VALUES (?,?,?)',
        [req.userId, sectId, 'member']
      );
      await conn.query('UPDATE sects SET member_count = member_count + 1 WHERE id = ?', [sectId]);
      await conn.commit();
      return success(res, null, `加入「${sect[0].name}」成功！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/sects/leave - 退出门派
router.post('/leave', authMiddleware, async (req, res, next) => {
  try {
    const [ps] = await pool.query(
      'SELECT ps.*, s.name FROM player_sect ps JOIN sects s ON ps.sect_id = s.id WHERE ps.user_id = ?',
      [req.userId]
    );
    if (ps.length === 0) return fail(res, '未加入门派');
    if (ps[0].role === 'leader') return fail(res, '掌门不能直接退出，请先转让或解散');

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM player_sect WHERE user_id = ?', [req.userId]);
      await conn.query('UPDATE sects SET member_count = member_count - 1 WHERE id = ?', [ps[0].sect_id]);
      await conn.commit();
      return success(res, null, `已退出「${ps[0].name}」`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/sects/donate - 捐献金币
router.post('/donate', authMiddleware, async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 100) return fail(res, '最低捐献100金币');

    const [ps] = await pool.query('SELECT * FROM player_sect WHERE user_id = ?', [req.userId]);
    if (ps.length === 0) return fail(res, '未加入门派');

    const [player] = await pool.query('SELECT gold FROM player_data WHERE user_id = ?', [req.userId]);
    if (player[0].gold < amount) return fail(res, '金币不足');

    const contribution = Math.floor(amount / 10); // 10金币=1贡献

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [amount, req.userId]);
      await conn.query('UPDATE sects SET funds = funds + ? WHERE id = ?', [amount, ps[0].sect_id]);
      await conn.query(
        'UPDATE player_sect SET contribution = contribution + ? WHERE user_id = ?',
        [contribution, req.userId]
      );
      await conn.commit();
      return success(res, { donated: amount, contribution }, `捐献 ${amount} 金币，获得 ${contribution} 贡献！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
