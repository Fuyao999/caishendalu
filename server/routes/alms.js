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
      'SELECT gold, mana, daily_alms, alms_miss_streak FROM player_data WHERE user_id = ?',
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
      `SELECT pd.gold, pd.mana, pd.daily_alms, pd.alms_miss_streak,
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

    await pool.query(
      `UPDATE player_data SET gold = gold + ?, mana = mana - ?, daily_alms = daily_alms - 1, alms_miss_streak = ?, merit = merit + 5 WHERE user_id = ?`,
      [netGain, manaCost, newMissStreak, req.userId]
    );

    await pool.query(
      'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
      [req.userId, 'alms', JSON.stringify({ area, mode: safeOrRisk, result: resultKey, netGain })]
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
      newMerit: (p.merit || 0) + 5,
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

module.exports = router;
