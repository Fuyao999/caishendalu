// ============================================
// 化缘路由 - 核心玩法（八卦区域化缘）
// 所有数值从 game_config 表读取，支持后台动态配置
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// 区域配置（门槛等基本信息不频繁改动，暂存内存）
const AREAS = {
  tianlu:  { name: '天禄', threshold: 100,    order: 1 },
  zhenyue: { name: '镇岳', threshold: 500,    order: 2 },
  longyin: { name: '龙吟', threshold: 1000,   order: 3 },
  fuyao:   { name: '扶摇', threshold: 5000,   order: 4 },
  nanming: { name: '南明', threshold: 10000,  order: 5 },
  dibao:   { name: '地宝', threshold: 50000,  order: 6 },
  ganze:   { name: '甘泽', threshold: 77777,  order: 7 },
  liquan:  { name: '流泉', threshold: 99999,  order: 8 },
};

// 内存缓存（5秒过期）
let _cfgCache = null;
let _cfgCacheTime = 0;
const CACHE_TTL = 5000;

// 获取化缘配置（优先从缓存读取）
async function getAlmsConfig() {
  const now = Date.now();
  if (_cfgCache && (now - _cfgCacheTime) < CACHE_TTL) {
    return _cfgCache;
  }
  try {
    const [rows] = await pool.query(
      "SELECT config_value FROM game_config WHERE config_name = 'alms_config'"
    );
    if (rows.length === 0) throw new Error('化缘配置不存在');
    let cfg = rows[0].config_value;
    if (typeof cfg === 'string') cfg = JSON.parse(cfg);
    _cfgCache = cfg;
    _cfgCacheTime = now;
    return cfg;
  } catch (e) {
    // 缓存失效时使用默认值
    return getDefaultConfig();
  }
}

function getDefaultConfig() {
  return {
    areas: {
      tianlu:  { threshold: 100,  JP: 0.02, BW: 0.10, NM: 0.50, SW: 0.30, MS: 0.08 },
      zhenyue: { threshold: 500,  JP: 0.03, BW: 0.12, NM: 0.40, SW: 0.30, MS: 0.15 },
      longyin: { threshold: 1000, JP: 0.04, BW: 0.14, NM: 0.32, SW: 0.25, MS: 0.25 },
      fuyao:   { threshold: 5000, JP: 0.05, BW: 0.15, NM: 0.25, SW: 0.20, MS: 0.35 },
      nanming: { threshold: 10000,JP: 0.06, BW: 0.16, NM: 0.18, SW: 0.15, MS: 0.45 },
      dibao:   { threshold: 50000,JP: 0.07, BW: 0.18, NM: 0.10, SW: 0.15, MS: 0.50 },
      ganze:   { threshold: 77777 },
      liquan:  { threshold: 99999 },
    },
    mult: { JP: 9.0, BW: 2.0, NM: 0.0, SW: -0.7, MS: -1.0 },
    safe: { lm: 0.10, mm: -0.30 },
    risk: { lm: -0.10, mm: 0.50 },
    gamble: { W2: { prob: 0.45, mult: 1.98 }, L2: { prob: 0.55, mult: 0.0 } },
    lossStreak: {
      level3: { trigger: 3, MS_factor: 0.5 },
      level5: { trigger: 5, MS: 0, SW: 0, NM: 0.50, BW: 0.35, JP: 0.15 }
    },
    dailyAlms: 20,
    manaCost: 5
  };
}

// GET /api/alms/status - 化缘状态
router.get('/status', authMiddleware, async (req, res, next) => {
  try {
    const cfg = await getAlmsConfig();
    const [rows] = await pool.query(
      'SELECT gold, mana, daily_alms, alms_miss_streak, fragments FROM player_data WHERE user_id = ?',
      [req.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];

    const unlocked = {};
    for (const [id, areaMeta] of Object.entries(AREAS)) {
      const cfgThreshold = cfg.areas[id]?.threshold ?? areaMeta.threshold;
      unlocked[id] = {
        name: areaMeta.name,
        threshold: cfgThreshold,
        order: areaMeta.order,
        unlocked: p.gold >= cfgThreshold,
      };
    }

    return success(res, {
      dailyAlms: p.daily_alms,
      gold: p.gold,
      mana: p.mana,
      missStreak: p.alms_miss_streak,
      areas: unlocked,
    }, '化缘状态');
  } catch (err) { next(err); }
});

// POST /api/alms/go - 执行化缘
router.post('/go', authMiddleware, async (req, res, next) => {
  try {
    const { area, mode, choice } = req.body;
    const safeOrRisk = mode || choice; // 兼容 HTML 和 Cocos
    const cfg = await getAlmsConfig();

    if (!area || !AREAS[area]) return fail(res, '无效的区域');
    if (!['safe', 'risk', 'risky'].includes(safeOrRisk)) return fail(res, '请选择稳求或险求');

    const areaMeta = AREAS[area]; // 保留 name/order 等元数据
    const areaThreshold = cfg.areas[area]?.threshold ?? areaMeta.threshold; // 门槛优先读配置
    const isGamble = areaMeta.order >= 7;

    const [rows] = await pool.query(
      `SELECT pd.gold, pd.mana, pd.daily_alms, pd.alms_miss_streak, pd.merit, pd.fragments, pd.reputation,
              (SELECT COUNT(*) FROM logs WHERE user_id = ? AND action = 'alms' AND JSON_EXTRACT(detail, '$.area') = ?) AS area_visit_count
       FROM player_data pd WHERE pd.user_id = ?`,
      [req.userId, area, req.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];

    const manaCost = cfg.manaCost || 5;
    const dailyAlms = cfg.dailyAlms || 20;

    if (p.daily_alms <= 0) return fail(res, `今日化缘次数已用完（${dailyAlms}次）`);
    if (p.mana < manaCost) return fail(res, `法力不足${manaCost}点，无法化缘`);
    if (p.gold < areaThreshold) return fail(res, `香火钱不足，无法进入${areaMeta.name}`);

    let resultKey, netGain;

    if (isGamble) {
      // 后2区：红黑对赌
      const gamble = cfg.gamble;
      if (!gamble || !gamble.W2 || !gamble.L2) {
        console.error('化缘配置错误: gamble config missing:', JSON.stringify(gamble));
        return fail(res, '化缘配置错误');
      }
      const rand = Math.random();
      resultKey = rand < gamble.W2.prob ? 'W2' : 'L2';
      const mult = resultKey === 'W2' ? gamble.W2.mult : gamble.L2.mult;
      netGain = resultKey === 'W2' ? Math.floor(areaThreshold * mult) : -areaThreshold;
    } else {
      // 前6区：概率调整 + 抽签
      const areaData = cfg.areas[area];
      if (!areaData) return fail(res, '区域概率配置错误');
      // 提取概率（排除 threshold）
      const baseProb = {JP: areaData.JP, BW: areaData.BW, NM: areaData.NM, SW: areaData.SW, MS: areaData.MS};

      const modeCfg = safeOrRisk === 'safe' ? cfg.safe : cfg.risk;
      const lm = modeCfg.lm;
      let a = {};
      for (const k in baseProb) {
        a[k] = k === 'MS' ? baseProb[k] * (1 - lm) : baseProb[k] * (1 + lm);
      }

      // 连亏保护
      const ls = cfg.lossStreak;
      if (p.alms_miss_streak >= ls.level5.trigger) {
        a.MS = ls.level5.MS;
        a.SW = ls.level5.SW;
        a.NM = ls.level5.NM;
        a.BW = ls.level5.BW;
        a.JP = ls.level5.JP;
      } else if (p.alms_miss_streak >= ls.level3.trigger) {
        a.MS *= ls.level3.MS_factor;
        a.NM += ls.level3.MS_factor * 0.16; // 补回概率
      }

      // 首访保护
      if (!p.area_visit_count || p.area_visit_count === 0) {
        a.MS = 0;
        a.SW = 0;
      }

      // 归一化
      let tot = 0;
      for (const k in a) tot += a[k];
      for (const k in a) a[k] = Math.max(0.001, a[k] / tot);

      // 抽签
      resultKey = rollResult(a);

      // 计算倍率
      const mult = cfg.mult[resultKey] * (1 + modeCfg.mm);
      netGain = Math.floor(areaThreshold * mult);
    }

    const isMiss = resultKey === 'MS' || resultKey === 'L2';
    const newMissStreak = isMiss ? p.alms_miss_streak + 1 : 0;

    // 8个区不加声望，只有碎片
    const repGain = 0;
    const fragGain = resultKey === 'JP' ? 3 : resultKey === 'W2' ? 5 : 0;

    await pool.query(
      `UPDATE player_data SET gold = gold + ?, mana = mana - ?, daily_alms = daily_alms - 1, alms_miss_streak = ?, merit = merit + ?, reputation = reputation + ?, fragments = fragments + ? WHERE user_id = ?`,
      [netGain, manaCost, newMissStreak, cfg.activeAlmsMerit || 5, repGain, fragGain, req.userId]
    );

    await pool.query(
      'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
      [req.userId, 'alms', JSON.stringify({ area, mode: safeOrRisk, result: resultKey, netGain, repGain, fragGain })]
    );

    const resultNames = {
      JP: '大吉大利', BW: '欧皇降临', NM: '平安顺遂', SW: '破财消灾', MS: '非酋本酋',
      W2: '大吉大利', L2: '非酋本酋'
    };

    return success(res, {
      area: areaMeta.name,
      areaId: area,
      mode: safeOrRisk,
      result: resultKey,
      resultName: resultNames[resultKey],
      netGain,
      remainAlms: p.daily_alms - 1,
      newGold: p.gold + netGain,
      newMana: p.mana - manaCost,
      newMerit: (p.merit || 0) + (cfg.activeAlmsMerit || 5),
      newReputation: (p.reputation || 0) + repGain,
      newFragments: (p.fragments || 0) + fragGain,
      fragGain: fragGain,
      fragBonus: fragGain > 0,
      missStreak: newMissStreak,
    }, `${areaMeta.name}化缘 —— ${resultNames[resultKey]}！`);

  } catch (err) { next(err); }
});

// GET /api/alms/history - 化缘记录
router.get('/history', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    const [rows] = await pool.query(
      `SELECT detail, created_at FROM logs WHERE user_id = ? AND action = 'alms' ORDER BY created_at DESC LIMIT ?`,
      [req.userId, parseInt(limit)]
    );
    const history = rows.map(r => ({
      ...JSON.parse(r.detail),
      time: r.created_at
    }));
    return success(res, history, '化缘记录');
  } catch (err) { next(err); }
});

// ======== 工具函数 ========
function rollResult(probTable) {
  const rand = Math.random();
  let cumulative = 0;
  for (const [key, prob] of Object.entries(probTable)) {
    cumulative += prob;
    if (rand <= cumulative) return key;
  }
  return Object.keys(probTable).pop();
}

// ============================================
// 被动化缘相关（待云游大厅完善后对接）
// ============================================

// 被动化缘 API
router.post('/passive', authMiddleware, async (req, res, next) => {
  try {
    const { targetPlayerId } = req.body;
    if (!targetPlayerId) return fail(res, '请选择要化缘的目标');

    const userId = req.user.userId;

    // 获取化缘者(A)数据
    const [almserRows] = await pool.query(
      `SELECT pd.user_id, pd.player_id, pd.gold, pd.temple_level, pd.level, pd.reputation,
              pd.temple_storage, pd.be_alms_count, pd.shield_end_at
       FROM player_data pd WHERE pd.user_id = ?`,
      [userId]
    );
    if (almserRows.length === 0) return fail(res, '玩家数据不存在');
    const almser = almserRows[0];

    // 检查化缘者是否有护盾
    const now = Date.now();
    if (almser.shield_end_at && almser.shield_end_at > now) {
      const remaining = Math.ceil((almser.shield_end_at - now) / 1000 / 60);
      return fail(res, `护盾中，还剩${remaining}分钟无法被化缘`);
    }

    // 获取被化缘者(B)数据
    const [targetRows] = await pool.query(
      `SELECT user_id, player_id, nickname, gold, temple_level, level, reputation,
              temple_storage, faith, fragments, be_alms_count, shield_end_at
       FROM player_data WHERE player_id = ?`,
      [targetPlayerId]
    );
    if (targetRows.length === 0) return fail(res, '目标玩家不存在');
    const target = targetRows[0];

    // 不能自己化缘自己
    if (target.user_id === userId) return fail(res, '不能化缘自己');

    // 计算被化缘者(B)的存储上限
    const storageLimit = 20 + (target.temple_level || 1) * 10;

    // 声誉加成 = floor(化缘者声望 / 10)
    const reputationBonus = Math.floor(almser.reputation / 10);

    // 基础上限（按化缘者庙宇等级）
    const baseLimits = { 1: 30, 2: 50, 3: 80, 4: 120, 5: 180 };
    const baseLimit = baseLimits[almser.temple_level] || 30;

    // 等级差系数 = 1 + (被化缘者等级 - 化缘者等级) * 0.1
    const levelDiffCoeff = 1 + (target.level - almser.level) * 0.1;

    // 储量系数 = min(被化缘者庙宇存储 / 存储上限, 2.0)
    const storageRatio = target.temple_storage > 0
      ? Math.min(target.temple_storage / storageLimit, 2.0)
      : 0;

    // 化缘金额 = floor(基础上限 * 等级差系数 * 储量系数 + 声誉加成)
    const almsAmount = Math.max(0, Math.floor(baseLimit * levelDiffCoeff * storageRatio + reputationBonus));

    // 被化缘者扣钱
    if (target.temple_storage < almsAmount) {
      // 钱不够，只扣剩余的
      const actualAlms = target.temple_storage;
      await pool.query(
        `UPDATE player_data SET temple_storage = 0 WHERE player_id = ?`,
        [targetPlayerId]
      );
      await pool.query(
        `UPDATE player_data SET gold = gold + ? WHERE user_id = ?`,
        [actualAlms, userId]
      );
    } else {
      // 正常扣
      await pool.query(
        `UPDATE player_data SET temple_storage = temple_storage - ? WHERE player_id = ?`,
        [almsAmount, targetPlayerId]
      );
      await pool.query(
        `UPDATE player_data SET gold = gold + ? WHERE user_id = ?`,
        [almsAmount, userId]
      );
    }

    // 被化缘者获得奖励
    await pool.query(
      `UPDATE player_data
       SET faith = faith + 1,
           reputation = reputation + 2,
           fragments = fragments + 1,
           be_alms_count = be_alms_count + 1
       WHERE player_id = ?`,
      [targetPlayerId]
    );

    // 检查是否需要开启护盾（被化缘满3次）
    const newBeAlmsCount = target.be_alms_count + 1;
    const shieldActivated = newBeAlmsCount >= 3;
    let newShieldEndAt = target.shield_end_at;
    if (shieldActivated && (!target.shield_end_at || target.shield_end_at <= now)) {
      newShieldEndAt = now + 3600000; // 1小时
      await pool.query(
        `UPDATE player_data SET shield_end_at = ? WHERE player_id = ?`,
        [newShieldEndAt, targetPlayerId]
      );
    }

    // 记录日志
    await pool.query(
      'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
      [userId, 'passive_alms', JSON.stringify({
        targetPlayerId,
        targetName: target.nickname,
        almsAmount,
        rewards: { faith: 1, reputation: 2, fragments: 1, beAlmsCount: newBeAlmsCount },
        shieldActivated
      })]
    );

    return success(res, {
      almsAmount,
      newGold: almser.gold + almsAmount,
      newTempleStorage: Math.max(0, target.temple_storage - almsAmount),
      newFaith: target.faith + 1,
      newReputation: target.reputation + 2,
      newFragments: target.fragments + 1,
      newBeAlmsCount,
      shieldActivated,
      shieldEndAt: newShieldEndAt,
    }, `向${target.nickname}化缘成功！获得${almsAmount}香火钱`);

  } catch (err) { next(err); }
});

// 获取玩家被化缘状态
router.get('/passive-status', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT be_alms_count, shield_end_at, faith FROM player_data WHERE user_id = ?',
      [req.user.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];
    const now = Date.now();
    const shieldActive = p.shield_end_at && p.shield_end_at > now;
    const shieldRemaining = shieldActive ? Math.ceil((p.shield_end_at - now) / 1000 / 60) : 0;

    return success(res, {
      beAlmsCount: p.be_alms_count || 0,
      shieldActive,
      shieldRemaining,
      faith: p.faith || 0,
    }, '被动化缘状态');
  } catch (err) { next(err); }
});

module.exports = router;
