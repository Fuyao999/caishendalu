// ============================================
// 活动路由 - 活动列表/参与/领奖
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/events - 当前活动列表
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, type, description, rewards, start_at, end_at, status
       FROM events
       WHERE status = 'active' OR (status = 'upcoming' AND start_at <= DATE_ADD(NOW(), INTERVAL 7 DAY))
       ORDER BY start_at`
    );
    return success(res, rows, '活动列表');
  } catch (err) { next(err); }
});

// GET /api/events/:id - 活动详情 + 我的进度
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const [event] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id]);
    if (event.length === 0) return fail(res, '活动不存在');

    const [progress] = await pool.query(
      'SELECT * FROM player_event_progress WHERE user_id = ? AND event_id = ?',
      [req.userId, req.params.id]
    );

    return success(res, {
      event: event[0],
      myProgress: progress[0] || null
    }, '活动详情');
  } catch (err) { next(err); }
});

// POST /api/events/:id/join - 参与活动
router.post('/:id/join', authMiddleware, async (req, res, next) => {
  try {
    const eventId = req.params.id;
    const [event] = await pool.query(
      "SELECT * FROM events WHERE id = ? AND status = 'active'", [eventId]
    );
    if (event.length === 0) return fail(res, '活动不存在或未开始');

    const [existing] = await pool.query(
      'SELECT id FROM player_event_progress WHERE user_id = ? AND event_id = ?',
      [req.userId, eventId]
    );
    if (existing.length > 0) return fail(res, '已参与该活动');

    await pool.query(
      'INSERT INTO player_event_progress (user_id, event_id, progress) VALUES (?,?,?)',
      [req.userId, eventId, JSON.stringify({ joined: true, tasks: {} })]
    );
    return success(res, null, `参与活动「${event[0].name}」成功！`);
  } catch (err) { next(err); }
});

// POST /api/events/:id/progress - 更新活动进度
router.post('/:id/progress', authMiddleware, async (req, res, next) => {
  try {
    const eventId = req.params.id;
    const { taskKey, value } = req.body;
    if (!taskKey) return fail(res, '请指定任务');

    const [prog] = await pool.query(
      'SELECT * FROM player_event_progress WHERE user_id = ? AND event_id = ?',
      [req.userId, eventId]
    );
    if (prog.length === 0) return fail(res, '未参与该活动');

    const progress = JSON.parse(prog[0].progress || '{}');
    if (!progress.tasks) progress.tasks = {};
    progress.tasks[taskKey] = (progress.tasks[taskKey] || 0) + (value || 1);

    await pool.query(
      'UPDATE player_event_progress SET progress = ? WHERE id = ?',
      [JSON.stringify(progress), prog[0].id]
    );
    return success(res, progress, '进度更新');
  } catch (err) { next(err); }
});

// POST /api/events/:id/claim - 领取活动奖励
router.post('/:id/claim', authMiddleware, async (req, res, next) => {
  try {
    const eventId = req.params.id;
    const { rewardIndex } = req.body;

    const [event] = await pool.query('SELECT * FROM events WHERE id = ?', [eventId]);
    if (event.length === 0) return fail(res, '活动不存在');

    const [prog] = await pool.query(
      'SELECT * FROM player_event_progress WHERE user_id = ? AND event_id = ?',
      [req.userId, eventId]
    );
    if (prog.length === 0) return fail(res, '未参与该活动');

    const rewards = JSON.parse(event[0].rewards || '[]');
    if (!rewards[rewardIndex]) return fail(res, '奖励不存在');

    const claimed = JSON.parse(prog[0].rewards_claimed || '[]');
    if (claimed.includes(rewardIndex)) return fail(res, '已领取该奖励');

    const reward = rewards[rewardIndex];
    // 检查进度是否达标
    const progress = JSON.parse(prog[0].progress || '{}');
    if (reward.requirement) {
      const taskValue = progress.tasks?.[reward.requirement.taskKey] || 0;
      if (taskValue < reward.requirement.value) {
        return fail(res, `进度不足（${taskValue}/${reward.requirement.value}）`);
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 发放奖励
      if (reward.gold) {
        await conn.query('UPDATE player_data SET gold = gold + ? WHERE user_id = ?', [reward.gold, req.userId]);
      }
      if (reward.yuanbao) {
        await conn.query('UPDATE player_data SET yuanbao = yuanbao + ? WHERE user_id = ?', [reward.yuanbao, req.userId]);
      }
      if (reward.exp) {
        await conn.query('UPDATE player_data SET exp = exp + ? WHERE user_id = ?', [reward.exp, req.userId]);
      }
      if (reward.itemId) {
        const [maxSlot] = await conn.query(
          'SELECT COALESCE(MAX(slot),0)+1 AS ns FROM inventory WHERE user_id = ?', [req.userId]
        );
        await conn.query(
          'INSERT INTO inventory (user_id, item_id, quantity, slot) VALUES (?,?,?,?)',
          [req.userId, reward.itemId, reward.quantity || 1, maxSlot[0].ns]
        );
      }

      // 标记已领取
      claimed.push(rewardIndex);
      await conn.query(
        'UPDATE player_event_progress SET rewards_claimed = ? WHERE id = ?',
        [JSON.stringify(claimed), prog[0].id]
      );

      await conn.commit();
      return success(res, reward, '奖励领取成功！');
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
