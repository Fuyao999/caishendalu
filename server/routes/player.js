const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail, getRealm, expForLevel } = require('../utils/helpers');

// GET /api/player/info - 获取玩家信息
router.get('/info', authMiddleware, async (req, res, next) => {
  try {
    // 读取化缘配置（用于法力恢复速度）
    let manaRegenPerHour = 10;
    try {
      const [cfgRows] = await pool.query("SELECT config_value FROM game_config WHERE config_name = 'alms_config'");
      if (cfgRows.length > 0) {
        const cfg = typeof cfgRows[0].config_value === 'string' ? JSON.parse(cfgRows[0].config_value) : cfgRows[0].config_value;
        manaRegenPerHour = cfg.manaRegenPerHour || 10;
      }
    } catch(e) { /* 用默认值 */ }

    const [rows] = await pool.query(
      `SELECT p.*, v.vip_level, v.monthly_card, v.total_recharge,
              p.invitation_code as invitationCode, p.invited_by as invitedBy
       FROM player_data p 
       LEFT JOIN player_vip v ON p.user_id = v.user_id 
       WHERE p.user_id = ?`, [req.user.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');

    const player = rows[0];

    // 解析 deity_buff JSON 字符串
    if (player.deity_buff && typeof player.deity_buff === 'string') {
      try {
        player.deity_buff = JSON.parse(player.deity_buff);
      } catch(e) {
        player.deity_buff = null;
      }
    }

    // 解析 deity_order JSON 字符串
    if (player.deity_order && typeof player.deity_order === 'string') {
      try {
        player.deity_order = JSON.parse(player.deity_order);
      } catch(e) {
        player.deity_order = null;
      }
    }

    // 计算离线法力恢复（根据后台配置的恢复速度，上限100）
    if (player.last_update_time) {
      const lastUpdate = parseInt(player.last_update_time);
      const now = Date.now();
      const elapsed = now - lastUpdate;
      const manaRecovered = Math.floor(elapsed * manaRegenPerHour / 3600000);
      player.mana = Math.min(100, Math.max(0, (player.mana || 0)) + manaRecovered);

      // 同时更新数据库
      await pool.query('UPDATE player_data SET mana=? WHERE user_id=?', [player.mana, req.user.userId]);
    }

    // 返回法力恢复速度供客户端使用
    player.manaRegenPerHour = manaRegenPerHour;

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
    // 同时重置好友的拜访次数（需要先通过user_id查到player_id）
    const [playerRows] = await pool.query(
      'SELECT player_id FROM player_data WHERE user_id = ?',
      [req.user.userId]
    );
    if (playerRows.length > 0) {
      await pool.query(
        `UPDATE friends SET visit_count = 0 WHERE player_id = ?`,
        [playerRows[0].player_id]
      );
    }
    return success(res, null, '每日重置完成');
  } catch(err) { next(err); }
});

// POST /api/player/add-exp - 增加经验
// POST /api/player/sync-data - 前端数据同步到服务器（覆盖式）
router.post('/sync-data', authMiddleware, async (req, res, next) => {
  try {
    const {
      gold, level, yuanbao, merit, mana, fragments, banners,
      gold_paper, fruits, incense_sticks, candles,
      // alms_count, great_count, worship_count, bushushort_small, bushushort_medium, bushushort_large,  // 这些字段只能通过服务器操作改变，不接受客户端sync
      daily_alms, daily_sign, sign_streak, total_sign, alms_miss_streak, alms_today,
      tutorial_completed, today_login, announcement_shown, last_login_date, shengxiao,
      inv, sr, task_claimed, area_first_visit, area_visited, player_name,
      incense_type, incense_end_at, shield_end_at, // be_alms_count,  // 这个也是只能服务器改
      read_announcements, mails,
      opened_heaven
    } = req.body;
    
    // temple_storage 只能通过服务器产出和玩家操作（收取/化缘）改变，不允许客户端sync覆盖
    // deity_buff和deity_order单独处理，不允许客户端传入null覆盖数据库
    const deityBuffInput = req.body.deity_buff;
    const deityOrderInput = req.body.deity_order;
    
    const realm = getRealm(level || 1);

    // 转换 last_login_date 为 MySQL DATE 格式（只取日期部分）
    const lastLoginDate = last_login_date ? new Date(last_login_date).toISOString().split('T')[0] : null;

    // 直接使用客户端上报的法力值（客户端已自行计算恢复）
    const manaToSave = Math.min(100, Math.max(0, mana || 0));

    // 只在客户端明确提供非null值时才更新deity_buff和deity_order
    const deityBuffToSave = deityBuffInput !== undefined ? (deityBuffInput ? JSON.stringify(deityBuffInput) : null) : undefined;
    const deityOrderToSave = deityOrderInput !== undefined ? (deityOrderInput ? JSON.stringify(deityOrderInput) : null) : undefined;

    // 动态构建更新字段
    let updateFields = [
      'gold=?', 'level=?', 'yuanbao=?', 'merit=?', 'mana=?', 'fragments=?', 'banners=?',
      'gold_paper=?', 'fruits=?', 'incense_sticks=?', 'candles=?',
      // alms_count, great_count, worship_count, bushushort_*, be_alms_count 由服务器操作，不接受客户端sync
      'daily_alms=?', 'daily_sign=?', 'sign_streak=?', 'total_sign=?', 'alms_miss_streak=?', 'alms_today=?',
      'tutorial_completed=?', 'today_login=?', 'announcement_shown=?', 'last_login_date=?', 'shengxiao=?',
      'inv=?', 'sr=?', 'task_claimed=?', 'area_first_visit=?', 'area_visited=?', 'player_name=?',
      'incense_type=?', 'incense_end_at=?', 'shield_end_at=?',
      'read_announcements=?', 'mails=?',
      'realm=?', 'realm_name=?', 'last_update_time=?',
      'opened_heaven=?'
    ];
    let updateValues = [
      Number(gold)||0, level||1, yuanbao||0, merit||0, manaToSave, fragments||0, banners||0,
      Number(gold_paper)||0, Number(fruits)||0, Number(incense_sticks)||0, Number(candles)||0,
      // 不包含 alms_count, great_count, worship_count 等
      daily_alms||20, daily_sign||0, sign_streak||0, total_sign||0, alms_miss_streak||0, alms_today||0,
      tutorial_completed||0, today_login||0, announcement_shown||0, lastLoginDate||null, (shengxiao !== null && shengxiao !== undefined ? shengxiao : null),
      inv||null, sr||null, task_claimed||null, area_first_visit||null, area_visited||null, player_name||null,
      incense_type||null, incense_end_at||null, shield_end_at||null,
      read_announcements||null, mails||null,
      realm.level, realm.name, Date.now(),
      opened_heaven||0
    ];
    
    // 只在明确提供时才添加deity_buff和deity_order更新
    if (deityBuffToSave !== undefined) {
      updateFields.push('deity_buff=?');
      updateValues.push(deityBuffToSave);
    }
    if (deityOrderToSave !== undefined) {
      updateFields.push('deity_order=?');
      updateValues.push(deityOrderToSave);
    }
    
    updateValues.push(req.user.userId);

    await pool.query(
      `UPDATE player_data SET ${updateFields.join(', ')} WHERE user_id=?`,
      updateValues
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
    console.log('[续香] 收到请求:', { incense_type, incense_end_at });
    const validTypes = ['incense', 'candle', 'paper', 'fruit'];
    const typeToSave = incense_type && validTypes.includes(incense_type) ? incense_type : null;
    if (!typeToSave) {
      console.log('[续香] 无效类型:', incense_type);
      return fail(res, '无效的香火类型');
    }
    const endAtToSave = incense_end_at ? Math.floor(Number(incense_end_at)) : null;
    if (!endAtToSave || isNaN(endAtToSave)) {
      console.log('[续香] 无效时间:', incense_end_at);
      return fail(res, '无效的香火结束时间');
    }
    await pool.query('UPDATE player_data SET incense_type = ?, incense_end_at = ? WHERE user_id = ?',
      [typeToSave, endAtToSave, req.user.userId]);
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

// POST /api/player/clear-shield - 清除玩家护盾（仅清除自己的）
router.post('/clear-shield', authMiddleware, async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE player_data SET has_shield = 0, shield_end_at = NULL, be_alms_count = 0 WHERE user_id = ?',
      [req.user.userId]
    );
    return success(res, null, '护盾已清除');
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

    // 更新签到任务进度
    try {
      const [signTasks] = await pool.query(
        "SELECT * FROM quests WHERE target_type = 'sign_days' AND type = 'daily' AND is_active = 1"
      );
      for (const task of signTasks) {
        const [progressRows] = await pool.query(
          'SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ?',
          [req.user.userId, task.id]
        );
        let currentProgress = progressRows.length > 0 ? (progressRows[0].progress || 0) : 0;
        currentProgress += 1;
        if (progressRows.length > 0) {
          await pool.query(
            'UPDATE quest_progress SET progress = ? WHERE user_id = ? AND quest_id = ?',
            [currentProgress, req.user.userId, task.id]
          );
        } else {
          await pool.query(
            'INSERT INTO quest_progress (user_id, quest_id, progress, claimed) VALUES (?, ?, ?, 0)',
            [req.user.userId, task.id, currentProgress]
          );
        }
        // 注意：活跃值在 quests.js 领取奖励时统一添加，不再在这里添加
      }
    } catch (err) {
      console.error('更新签到任务失败:', err);
    }

    return success(res, { streak, reward, total: rows[0].total_sign + 1 }, `签到成功！连续${streak}天，奖励${reward}香火钱`);
  } catch(err) { next(err); }
});

// POST /api/player/collect-temple - 收取庙宇存储
router.get('/temple-data', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT level, temple_storage, incense_type, incense_end_at FROM player_data WHERE user_id=?',
      [req.user.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];
    const now = Date.now();
    return success(res, {
      level: p.level,
      temple_storage: p.temple_storage,
      incense_type: p.incense_type,
      incense_end_at: p.incense_end_at,
      is_burning: p.incense_type && p.incense_end_at && p.incense_end_at > now
    });
  } catch(err) { next(err); }
});

router.post('/collect-temple', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT temple_storage, gold FROM player_data WHERE user_id=?', [req.user.userId]);
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    
    const templeStorage = Number(rows[0].temple_storage) || 0;
    const currentGold = Number(rows[0].gold) || 0;
    if (templeStorage <= 0) {
      return success(res, { collected: 0, money: currentGold }, '庙宇存储为0');
    }
    
    // 把庙宇存储加到玩家金钱
    await pool.query(
      'UPDATE player_data SET temple_storage=0, gold=gold+? WHERE user_id=?',
      [templeStorage, req.user.userId]
    );
    
    return success(res, { collected: templeStorage, money: currentGold + templeStorage }, '收取成功');
  } catch(err) { next(err); }
});

// 升级庙宇配置
const upgradeNeeds = {
  1: { money: 5000, banners: 3, merit: 100 },
  2: { money: 15000, banners: 6, merit: 500 },
  3: { money: 50000, banners: 10, merit: 1500 },
  4: { money: 150000, banners: 15, merit: 3300 }
};

// 检查财神是否解锁（与客户端相同逻辑）
function checkGodUnlocked(p, godId) {
  switch(godId) {
    case 'tudigong': return true;
    case 'guanyu': return (p.level || 1) >= 3;
    case 'yaoshaosi': return (p.alms_count || 0) >= 30;
    case 'chenjiugong': return (p.gold || 0) >= 5000;
    case 'fanli': return (p.merit || 0) >= 100;
    case 'caobao': return (p.great_count || 0) >= 3 && (p.worship_count || 0) >= 100;
    case 'liuhai': return (p.great_count || 0) >= 1;
    case 'xiaosheng': return (p.worship_count || 0) >= 50;
    default: return false;
  }
}

// POST /api/player/open-heaven-door - 开天门（5级升6级）
router.post('/open-heaven-door', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT level, gold, alms_count, great_count, worship_count, merit FROM player_data WHERE user_id=?',
      [req.user.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];
    
    if (p.level !== 5) return fail(res, '只有5级才能开天门');
    
    // 检查8位财神是否全齐（不包括赵公明）
    const otherGods = ['tudigong', 'guanyu', 'yaoshaosi', 'chenjiugong', 'fanli', 'caobao', 'liuhai', 'xiaosheng'];
    const allUnlocked = otherGods.every(id => checkGodUnlocked(p, id));
    if (!allUnlocked) return fail(res, '9位财神未全部解锁');
    
    // 检查香火钱是否足够
    if ((p.gold || 0) < 500000) return fail(res, '香火钱不足，需要50万');
    
    // 执行开天门
    await pool.query(
      'UPDATE player_data SET gold=gold-500000, level=6 WHERE user_id=?',
      [req.user.userId]
    );
    
    return success(res, {
      newLevel: 6,
      newGold: p.gold - 500000
    }, '🎉 开天门成功！赵公明降临，恭喜进入第二阶段！');
  } catch(err) { next(err); }
});

// POST /api/player/upgrade-temple - 升级庙宇
router.post('/upgrade-temple', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT gold, banners, merit, level FROM player_data WHERE user_id=?',
      [req.user.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];
    
    if (p.level >= 5) return fail(res, '庙宇已达最高等级');
    
    const need = upgradeNeeds[p.level];
    if (!need) return fail(res, '升级配置错误');
    
    if (p.gold < need.money) return fail(res, `香火钱不足，需要${need.money}`);
    if (p.banners < need.banners) return fail(res, `招财幡不足，需要${need.banners}个`);
    if (p.merit < need.merit) return fail(res, `功德不足，需要${need.merit}`);
    
    await pool.query(
      'UPDATE player_data SET gold=gold-?, banners=banners-?, level=level+1 WHERE user_id=?',
      [need.money, need.banners, req.user.userId]
    );
    
    return success(res, {
      newLevel: p.level + 1,
      newGold: p.gold - need.money,
      newBanners: p.banners - need.banners,
      newMerit: p.merit  // 功德只是门槛，不扣除
    }, `升级成功！庙宇等级提升至${p.level + 1}`);
  } catch(err) { next(err); }
});

// POST /api/player/compose-banner - 合成招财幡（4碎片=1招财幡）
router.post('/compose-banner', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT fragments, banners FROM player_data WHERE user_id=?', [req.user.userId]);
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];
    
    if (p.fragments < 4) return fail(res, '碎片不足，需要4个碎片');
    
    await pool.query(
      'UPDATE player_data SET fragments=fragments-4, banners=banners+1 WHERE user_id=?',
      [req.user.userId]
    );
    
    return success(res, {
      newFragments: p.fragments - 4,
      newBanners: p.banners + 1
    }, '合成招财幡成功！');
  } catch(err) { next(err); }
});

// POST /api/player/incense-friend - 代点香（消耗500香火钱，不增加善缘）
router.post('/incense-friend', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT gold, faith FROM player_data WHERE user_id=?', [req.user.userId]);
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];
    
    if (p.gold < 500) return fail(res, '香火钱不足，需要500');
    
    await pool.query(
      'UPDATE player_data SET gold=gold-500 WHERE user_id=?',
      [req.user.userId]
    );
    
    return success(res, {
      newGold: p.gold - 500
    }, '代点香成功！');
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
