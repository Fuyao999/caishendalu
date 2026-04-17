const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail, getRealm, expForLevel } = require('../utils/helpers');

// GET /api/player/info - 获取玩家信息
router.get('/info', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, v.vip_level, v.monthly_card, v.total_recharge,
              p.invitation_code as invitationCode, p.invited_by as invitedBy
       FROM player_data p 
       LEFT JOIN player_vip v ON p.user_id = v.user_id 
       WHERE p.user_id = ?`, [req.user.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');

    const player = rows[0];

    // 计算离线法力恢复（10点/小时，上限100）
    if (player.last_update_time) {
      const elapsed = Date.now() - new Date(player.last_update_time).getTime();
      const manaRecovered = Math.floor(elapsed * 10 / 3600000);
      player.mana = Math.min(100, Math.max(0, (player.mana || 0)) + manaRecovered);
      // 同时更新数据库
      await pool.query('UPDATE player_data SET mana=? WHERE user_id=?', [player.mana, req.user.userId]);
    }

    return success(res, player);
  } catch(err) { next(err); }
});

// POST /api/player/daily-reset - 每日重置
router.post('/daily-reset', authMiddleware, async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    await pool.query(
      `UPDATE player_data SET daily_alms=20, daily_sign=0, visit_count=0, last_daily_reset=? WHERE user_id=? AND (last_daily_reset IS NULL OR last_daily_reset<?)`,
      [today, req.user.userId, today]
    );
    return success(res, null, '每日重置完成');
  } catch(err) { next(err); }
});

// POST /api/player/add-exp - 增加经验
// POST /api/player/sync-data - 前端数据同步到服务器（覆盖式）
router.post('/sync-data', authMiddleware, async (req, res, next) => {
  try {
    const {
      gold, level, yuanbao, merit, mana, fragments, banners, faith, reputation,
      gold_paper, fruits, incense_sticks, candles,
      alms_count, great_count, worship_count, bushushort_small, bushushort_medium, bushushort_large,
      daily_alms, daily_sign, sign_streak, total_sign, alms_miss_streak, alms_today,
      tutorial_completed, today_login, announcement_shown, last_login_date, shengxiao,
      inv, sr, task_claimed, area_first_visit, area_visited, player_name,
      incense_type, incense_end_at, shield_end_at, be_alms_count,
      read_announcements, mails,
      temple_storage, opened_heaven, deity_buff
    } = req.body;
    const realm = getRealm(level || 1);

    // 转换 last_login_date 为 MySQL DATE 格式（只取日期部分）
    const lastLoginDate = last_login_date ? new Date(last_login_date).toISOString().split('T')[0] : null;

    // 直接使用客户端上报的法力值（客户端已自行计算恢复）
    const manaToSave = Math.min(100, Math.max(0, mana || 0));

    await pool.query(
      `UPDATE player_data SET
        gold=?, level=?, yuanbao=?, merit=?, mana=?, fragments=?, banners=?, faith=?, reputation=?,
        gold_paper=?, fruits=?, incense_sticks=?, candles=?,
        alms_count=?, great_count=?, worship_count=?, bushushort_small=?, bushushort_medium=?, bushushort_large=?,
        daily_alms=?, daily_sign=?, sign_streak=?, total_sign=?, alms_miss_streak=?, alms_today=?,
        tutorial_completed=?, today_login=?, announcement_shown=?, last_login_date=?, shengxiao=?,
        inv=?, sr=?, task_claimed=?, area_first_visit=?, area_visited=?, player_name=?,
        incense_type=?, incense_end_at=?, shield_end_at=?, be_alms_count=?,
        read_announcements=?, mails=?,
        realm=?, realm_name=?, last_update_time=?,
        temple_storage=?, opened_heaven=?, deity_buff=?
       WHERE user_id=?`,
      [
        gold||0, level||1, yuanbao||0, merit||0, manaToSave, fragments||0, banners||0, faith||0, reputation||0,
        gold_paper||0, fruits||0, incense_sticks||0, candles||0,
        alms_count||0, great_count||0, worship_count||0, bushushort_small||0, bushushort_medium||0, bushushort_large||0,
        daily_alms||20, daily_sign||0, sign_streak||0, total_sign||0, alms_miss_streak||0, alms_today||0,
        tutorial_completed||0, today_login||0, announcement_shown||0, lastLoginDate||null, (shengxiao !== null && shengxiao !== undefined ? shengxiao : null),
        inv||null, sr||null, task_claimed||null, area_first_visit||null, area_visited||null, player_name||null,
        incense_type||null, incense_end_at||null, shield_end_at||null, be_alms_count||0,
        read_announcements||null, mails||null,
        realm.level, realm.name, Date.now(),
        temple_storage||0, opened_heaven||0, deity_buff||null,
        req.user.userId
      ]
    );
    return success(res, null, '数据已同步');
  } catch(err) { next(err); }
});

router.post('/add-exp', authMiddleware, async (req, res, next) => {
  try {
    const { amount } = req.body;
    const [rows] = await pool.query('SELECT level, exp FROM player_data WHERE user_id=?', [req.user.userId]);
    if (rows.length === 0) return fail(res, '玩家不存在');
    let { level, exp } = rows[0];
    exp += amount;
    let leveledUp = false;
    while (level < 99 && exp >= expForLevel(level)) {
      exp -= expForLevel(level);
      level++;
      leveledUp = true;
    }
    const realm = getRealm(level);
    await pool.query(
      'UPDATE player_data SET level=?, exp=?, realm=?, realm_name=? WHERE user_id=?',
      [level, exp, realm.level, realm.name, req.user.userId]
    );
    return success(res, { level, exp, realm: realm.name, leveledUp });
  } catch(err) { next(err); }
});

// POST /api/player/update-nickname - 更新昵称
router.post('/update-nickname', authMiddleware, async (req, res, next) => {
  try {
    const { nickname } = req.body;
    if (!nickname || nickname.length > 20) return fail(res, '昵称无效（1-20字）');
    await pool.query('UPDATE player_data SET nickname = ? WHERE user_id = ?', [nickname, req.user.userId]);
    return success(res, null, '昵称已更新');
  } catch (err) { next(err); }
});

// POST /api/player/update-incense - 同步香火状态
router.post('/update-incense', authMiddleware, async (req, res, next) => {
  try {
    const { incense_type, incense_end_at } = req.body;
    await pool.query('UPDATE player_data SET incense_type = ?, incense_end_at = ? WHERE user_id = ?',
      [incense_type || null, incense_end_at || null, req.user.userId]);
    return success(res, null, '香火状态已同步');
  } catch (err) { next(err); }
});

// POST /api/player/update-player-id - 同步玩家游戏ID
router.post('/update-player-id', authMiddleware, async (req, res, next) => {
  try {
    const { player_id } = req.body;
    if (!player_id) return fail(res, '玩家ID无效');
    // 只在服务器端没有记录时才设置（防止覆盖）
    const [rows] = await pool.query('SELECT player_id FROM player_data WHERE user_id=?', [req.user.userId]);
    if (rows[0] && rows[0].player_id) {
      return success(res, { player_id: rows[0].player_id }, '已有玩家ID');
    }
    await pool.query('UPDATE player_data SET player_id = ? WHERE user_id = ?', [player_id, req.user.userId]);
    return success(res, { player_id }, '玩家ID已同步');
  } catch (err) { next(err); }
});

// POST /api/player/sign-in - 签到
router.post('/sign-in', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT daily_sign, sign_streak, total_sign FROM player_data WHERE user_id=?', [req.user.userId]);
    if (rows[0].daily_sign) return fail(res, '今日已签到');
    const streak = rows[0].sign_streak + 1;
    const reward = 500 + Math.min(streak, 7) * 100;
    await pool.query(
      `UPDATE player_data SET daily_sign=1, sign_streak=?, total_sign=total_sign+1, gold=gold+? WHERE user_id=?`,
      [streak, reward, req.user.userId]
    );
    return success(res, { streak, reward, total: rows[0].total_sign + 1 }, `签到成功！连续${streak}天，奖励${reward}香火钱`);
  } catch(err) { next(err); }
});

// POST /api/player/collect-temple - 收取庙宇存储
router.post('/collect-temple', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT temple_storage, gold FROM player_data WHERE user_id=?', [req.user.userId]);
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    
    const templeStorage = rows[0].temple_storage || 0;
    if (templeStorage <= 0) {
      return success(res, { collected: 0, money: rows[0].gold }, '庙宇存储为0');
    }
    
    // 把庙宇存储加到玩家金钱
    await pool.query(
      'UPDATE player_data SET temple_storage=0, gold=gold+? WHERE user_id=?',
      [templeStorage, req.user.userId]
    );
    
    return success(res, { collected: templeStorage, money: rows[0].gold + templeStorage }, '收取成功');
  } catch(err) { next(err); }
});

// GET /api/player/rank-list - 获取排行榜
router.get('/rank-list', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT user_id, nickname, level, gold, merit, worship_count, sign_streak, total_sign 
       FROM player_data ORDER BY gold DESC LIMIT 50`
    );
    return success(res, rows, '获取成功');
  } catch(err) { next(err); }
});

module.exports = router;
