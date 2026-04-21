// ============================================
// 云游大厅路由 - 发现陌生玩家，被动化缘
// ============================================
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// 基础上限（按庙宇等级）
const BASE_LIMITS = { 1: 30, 2: 50, 3: 80, 4: 120, 5: 180 };

// 庙宇存储上限（按庙宇等级）
const STORAGE_LIMITS = { 1: 5000, 2: 10000, 3: 18000, 4: 30000, 5: 50000 };

// 庙宇每小时产出（按庙宇等级）
const HOURLY_OUTPUT = { 1: 100, 2: 180, 3: 250, 4: 333, 5: 417 };

// 财神类型定义（用于过滤庇佑加成适用性）
// type: money=香火钱加成, alms=化缘加成, cap=存储上限, risk=风险降低
const GOD_TYPES = {
  tudigong: 'money',     // 土地公: 香火钱+10%
  guanyu: 'alms',        // 关羽: 化缘收益+15%
  yaoshaosi: 'alms',     // 姚少司: 化缘30次
  chenjiugong: 'cap',    // 陈九公: 香火钱上限+500
  fanli: 'money',        // 范蠡: 香火钱+20%
  caobao: 'risk',        // 曹宝: 化缘风险-10%
  liuhai: 'money',       // 刘海: 香火钱+15%
  xiaosheng: 'alms',     // 萧升: 化缘收益+20%
  zhaogongming: 'money'  // 赵公明: 香火钱+25%
};

// 获取游戏配置
async function getGameConfig() {
  try {
    const [rows] = await pool.query("SELECT config_value FROM game_config WHERE config_name = 'alms_config'");
    return rows.length > 0 ? rows[0].config_value : {};
  } catch (e) {
    console.error('获取游戏配置失败:', e);
    return {};
  }
}

// 计算机器人香火钱（根据时间恢复）
function calculateRobotStorage(robot) {
  const now = Date.now();
  const updatedAt = robot.updated_at ? new Date(robot.updated_at).getTime() : now;
  const elapsedMs = now - updatedAt;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  
  let templeLevel = robot.level || 1;
  let storageLimit = STORAGE_LIMITS[templeLevel] || 5000;
  const hourlyOutput = HOURLY_OUTPUT[templeLevel] || 100;
  
  // 计算应该恢复的香火钱
  const production = hourlyOutput * elapsedHours;
  let newStorage = robot.temple_storage + Math.floor(production);
  
  // 如果存储超过上限，直接cap住（不自动升级，防止存储突破上限）
  if (newStorage > storageLimit) {
    newStorage = storageLimit;
  }
  
  return newStorage;
}

// 机器人数据现在从数据库读取，不再写死在这里

// 打乱数组
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 获取云游大厅玩家列表
router.get('/list', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // 检查功德门槛
    const [meRows] = await pool.query(
      'SELECT merit, level FROM player_data WHERE user_id = ?',
      [userId]
    );
    if (meRows.length === 0) return fail(res, '玩家数据不存在');
    const me = meRows[0];

    if ((me.merit || 0) < 100) {
      return fail(res, '功德值不足100，无法进入云游大厅');
    }

    const now = Date.now();

    // 获取真实玩家（排除自己，按存储量排，最多取100个）
    const [realPlayers] = await pool.query(
      `SELECT player_id, nickname, level, temple_storage, level,
              shield_end_at, reputation, last_update_time
       FROM player_data
       WHERE user_id != ?
       ORDER BY temple_storage DESC
       LIMIT 100`,
      [userId]
    );

    // 混合真实玩家和机器人：最多2个真实玩家，其余用机器人填满6个
    const realCount = Math.min(realPlayers.length, 2);
    const robotCount = 6 - realCount;

    // 从数据库获取机器人
    const [dbRobots] = await pool.query(
      `SELECT player_id, nickname, level, temple_storage, level, reputation, has_shield, shield_end_at, updated_at
       FROM robots WHERE disabled = 0 ORDER BY temple_storage DESC LIMIT 20`
    );

    // 打乱并选取
    const shuffledReal = shuffle([...realPlayers]).slice(0, realCount);
    const shuffledRobots = shuffle([...dbRobots]).slice(0, robotCount);

    // 获取机器人无产出比例配置
    const gameConfig = await getGameConfig();
    const robotNoProductionRate = gameConfig.robotNoProductionRate || 0.05;

    const selected = [
      ...shuffledReal.map(p => ({
        playerId: p.player_id,
        nickname: p.nickname || '匿名道友',
        level: p.level || 1,
        templeStorage: p.temple_storage || 0,
        reputation: p.reputation || 0,
        hasShield: !!(p.shield_end_at && p.shield_end_at > now),
        isRobot: false,
      })),
      ...shuffledRobots.map(r => {
        // 95%有产出，5%没产出（模拟真实玩家香火灭了的情况）
        const hasProduction = Math.random() > robotNoProductionRate;
        // 计算基于时间的香火钱恢复
        const newStorage = hasProduction ? calculateRobotStorage(r) : 0;
        
        // 把计算结果存回数据库（异步，不阻塞返回）
        if (newStorage !== r.temple_storage) {
          pool.query(
            'UPDATE robots SET temple_storage = ?, updated_at = NOW() WHERE player_id = ?',
            [newStorage, r.player_id]
          ).catch(e => console.error('更新机器人存储失败:', e));
        }
        
        return {
          playerId: r.player_id,
          nickname: r.nickname,
          level: r.level,
          templeStorage: newStorage,
          reputation: r.reputation,
          hasShield: !!(r.has_shield || (r.shield_end_at && r.shield_end_at > now)),
          isRobot: true,
        };
      }),
    ].sort((a, b) => b.templeStorage - a.templeStorage);

    return success(res, {
      players: selected,
      total: selected.length,
      myLevel: me.level,
      myMerit: me.merit,
    }, '云游大厅');

  } catch (err) { next(err); }
});

// 执行云游化缘
router.post('/alms', authMiddleware, async (req, res, next) => {
  console.log('[CloudTour alms] 收到化缘请求, userId:', req.user?.userId);
  try {
    const { targetPlayerId } = req.body;
    if (!targetPlayerId) return fail(res, '请选择要化缘的目标');

    const userId = req.user.userId;
    const targetId = parseInt(targetPlayerId);

    // 检查是否是机器人
    const isRobot = targetId >= 900001 && targetId <= 999999;

    // 获取化缘者(A)数据
    const [almserRows] = await pool.query(
      `SELECT pd.user_id, pd.player_id, pd.gold, pd.level, pd.level, pd.reputation, pd.merit,
              pd.temple_storage AS myStorage, pd.fragments,
              pd.be_alms_count, pd.shield_end_at, pd.mana, pd.deity_buff, pd.deity_order
       FROM player_data pd WHERE pd.user_id = ?`,
      [userId]
    );
    if (almserRows.length === 0) return fail(res, '玩家数据不存在');
    const almser = almserRows[0];

    // 检查法力（用客户端传来的当前法力值，更准确）
    const manaCost = 5;
    const currentMana = Number(req.body.currentMana || almser.mana || 0);
    if (currentMana < manaCost) {
      return fail(res, `法力不足${manaCost}点，当前只有${currentMana}点`);
    }

    // 检查化缘者是否有护盾
    const now = Date.now();
    if (almser.shield_end_at && almser.shield_end_at > now) {
      const remaining = Math.ceil((almser.shield_end_at - now) / 1000 / 60);
      return fail(res, `护盾中，还剩${remaining}分钟无法被化缘`);
    }

    let target;
    let isRobotFlag = false;

    // 先查 robots 表
    const [robotRows] = await pool.query(
      `SELECT player_id, nickname, level, temple_storage, level, reputation,
              faith, fragments, be_alms_count, has_shield, shield_end_at
       FROM robots WHERE player_id = ?`,
      [targetId]
    );
    if (robotRows.length > 0) {
      // 找到了，按机器人处理
      isRobotFlag = true;
      const robot = robotRows[0];
      target = {
        user_id: 0,
        player_id: robot.player_id,
        nickname: robot.nickname,
        level: robot.level,
        reputation: robot.reputation,
        temple_storage: robot.temple_storage,
        level: robot.level,
        faith: robot.faith || 0,
        fragments: robot.fragments || 0,
        be_alms_count: robot.be_alms_count || 0,
        shield_end_at: robot.shield_end_at || 0,
      };
    } else {
      // 没找到，去数据库查真实玩家
      const [targetRows] = await pool.query(
        `SELECT user_id, player_id, nickname, gold, level, level, reputation,
                temple_storage, faith, fragments, be_alms_count, shield_end_at
         FROM player_data WHERE player_id = ?`,
        [targetId]
      );
      if (targetRows.length === 0) return fail(res, '目标玩家不存在');
      target = targetRows[0];
      if (target.user_id === userId) return fail(res, '不能化缘自己');
    }

    // 检查今日是否已化缘该目标
    const [logRows] = await pool.query(
      `SELECT id FROM logs
       WHERE user_id = ? AND action = 'cloud_tour_alms'
         AND JSON_EXTRACT(detail, '$.targetPlayerId') = ?
         AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      [userId, targetId]
    );
    if (logRows.length > 0) {
      return fail(res, `今日已化缘过该玩家，明日再来`);
    }

    // 检查并使用财神庇佑
    let usedBlessing = null;
    let blessingBonus = 0;
    let deityBuff = almser.deity_buff;
    if (deityBuff && typeof deityBuff === 'string') {
      try {
        deityBuff = JSON.parse(deityBuff);
      } catch(e) { deityBuff = null; }
    }
    if (deityBuff && typeof deityBuff === 'object') {
      // 从deity_order获取顺序，按顺序找第一个有count的财神
      let order = [];
      try {
        if (almser.deity_order) {
          order = typeof almser.deity_order === 'string' ? JSON.parse(almser.deity_order) : almser.deity_order;
        }
      } catch(e) { order = []; }
      // 如果没有order，用默认顺序（Object.keys的顺序）
      if (!order || order.length === 0) {
        order = Object.keys(deityBuff).filter(k => k !== 'order');
      }
      // 按顺序找第一个有count>0的财神（只考虑money和alms类型，不适用cap类型）
      usedBlessing = null;
      blessingBonus = 0;
      for (const godId of order) {
        const godType = GOD_TYPES[godId];
        // 跳过cap类型的财神（如陈九公：香火钱上限加成不适用于化缘金额）
        if (godType === 'cap') continue;
        if (deityBuff[godId] && deityBuff[godId].count > 0) {
          usedBlessing = godId;
          blessingBonus = deityBuff[godId].bonus || 0;
          deityBuff[godId].count -= 1;
          if (deityBuff[godId].count <= 0) {
            delete deityBuff[godId];
          }
          break;
        }
      }
      if (!usedBlessing) {
        blessingBonus = 0;
      }
    }

    // 计算化缘金额
    const storageLimit = 20 + (target.level || 1) * 10;
    const reputationBonus = Math.floor(almser.reputation / 10);
    const baseLimit = BASE_LIMITS[almser.level] || 30;
    const levelDiffCoeff = 1 + (target.level - almser.level) * 0.1;
    const storageRatio = target.temple_storage > 0
      ? Math.min(target.temple_storage / storageLimit, 2.0)
      : 0;
    const baseAmount = Math.max(0, Math.floor(baseLimit * levelDiffCoeff * storageRatio + reputationBonus));
    // blessingBonus: <1按百分比(0.1=10%)，>=1按固定值
    const almsAmount = blessingBonus > 0 && blessingBonus < 1
      ? Math.floor(baseAmount * (1 + blessingBonus))
      : baseAmount + Math.floor(blessingBonus);

    // 计算化缘结果：大吉/小吉/顺利/平淡/小凶/大凶
    const rand = Math.random();
    let resultLevel = 'normal'; // 默认平淡
    let isGreat = false;
    if (rand < 0.10) { // 10%概率大吉
      resultLevel = 'great';
      isGreat = true;
    } else if (rand < 0.25) { // 15%概率小吉
      resultLevel = 'small';
    } else if (rand < 0.40) { // 15%概率顺利
      resultLevel = 'smooth';
    } else if (rand < 0.60) { // 20%概率平淡
      resultLevel = 'normal';
    } else if (rand < 0.80) { // 20%概率小凶
      resultLevel = 'small_bad';
    } else { // 20%概率大凶
      resultLevel = 'bad';
    }

    // 保存更新后的 deity_buff
    if (usedBlessing) {
      await pool.query(
        'UPDATE player_data SET deity_buff = ? WHERE user_id = ?',
        [JSON.stringify(deityBuff), userId]
      );
    }

    let newGold, newTempleStorage, newFragments;

    if (isRobotFlag) {
      // 机器人：只加钱，不真实扣对方数据
      newGold = Number(almser.gold) + almsAmount;
      newTempleStorage = Math.max(0, target.temple_storage - almsAmount);
      newFragments = (almser.fragments || 0) + 1;
      await pool.query(
        `UPDATE player_data SET gold = ?, mana = mana - ?, fragments = fragments + 1, reputation = reputation + 1, merit = merit + 5, alms_count = alms_count + 1${isGreat ? ', great_count = great_count + 1' : ''} WHERE user_id = ?`,
        [newGold, manaCost, userId]
      );
    } else {
      // 真实玩家：扣对方庙宇存储
      if (target.temple_storage < almsAmount) {
        const actualAlms = target.temple_storage;
        newFragments = (almser.fragments || 0) + 1;
        await pool.query(
          `UPDATE player_data SET temple_storage = 0 WHERE player_id = ?`,
          [targetId]
        );
        await pool.query(
          `UPDATE player_data SET gold = gold + ?, mana = mana - ?, fragments = fragments + 1, reputation = reputation + 1, merit = merit + 5, alms_count = alms_count + 1${isGreat ? ', great_count = great_count + 1' : ''} WHERE user_id = ?`,
          [actualAlms, manaCost, userId]
        );
        newGold = Number(almser.gold) + actualAlms;
        newTempleStorage = 0;
      } else {
        await pool.query(
          `UPDATE player_data SET temple_storage = temple_storage - ? WHERE player_id = ?`,
          [almsAmount, targetId]
        );
        newFragments = (almser.fragments || 0) + 1;
        await pool.query(
          `UPDATE player_data SET gold = gold + ?, mana = mana - ?, fragments = fragments + 1, reputation = reputation + 1, merit = merit + 5, alms_count = alms_count + 1${isGreat ? ', great_count = great_count + 1' : ''} WHERE user_id = ?`,
          [almsAmount, manaCost, userId]
        );
        newGold = Number(almser.gold) + almsAmount;
        newTempleStorage = target.temple_storage - almsAmount;
      }

      // 被化缘者获得奖励
      await pool.query(
        `UPDATE player_data
         SET faith = faith + 1,
             reputation = reputation + 2,
             fragments = fragments + 1,
             be_alms_count = be_alms_count + 1
         WHERE player_id = ?`,
        [targetId]
      );

      // 检查护盾
      const newBeAlmsCount = (target.be_alms_count || 0) + 1;
      if (newBeAlmsCount >= 3) {
        const newShieldEndAt = now + 3600000; // 1小时
        await pool.query(
          `UPDATE player_data SET shield_end_at = ? WHERE player_id = ?`,
          [newShieldEndAt, targetId]
        );
      }
    }

    // 记录日志
    await pool.query(
      'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
      [userId, 'cloud_tour_alms', JSON.stringify({
        targetPlayerId: targetId,
        targetName: target.nickname,
        almsAmount,
        isRobotFlag,
      })]
    );

    return success(res, {
      almsAmount,
      newGold,
      newMana: (almser.mana || 0) - manaCost,
      newTempleStorage,
      newFragments: newFragments,
      newMerit: (almser.merit || 0) + 5,
      newFaith: (target.faith || 0) + 1,
      newReputation: (almser.reputation || 0) + 1,
      targetName: target.nickname,
      usedBlessing,
      blessingBonus,
      resultLevel,
      isGreat,
      deityBuff: usedBlessing ? deityBuff : null,
    }, `向${target.nickname}云游化缘成功！获得${almsAmount}香火钱`);

  } catch (err) { next(err); }
});

module.exports = router;
