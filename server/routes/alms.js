// ============================================
// 化缘路由 - 核心玩法（八卦区域化缘）
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// 区域配置
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

// 前6区概率表 (稳求 / 险求)
const PROB_SAFE  = { JP: 0.10, BW: 0.25, NM: 0.35, SW: 0.20, MS: 0.10 };
const PROB_RISKY = { JP: 0.20, BW: 0.15, NM: 0.20, SW: 0.20, MS: 0.25 };
// 前6区倍率表
const MULTI_SAFE  = { JP: 3.0, BW: 1.5, NM: 1.0, SW: 0.5, MS: 0.0 };
const MULTI_RISKY = { JP: 5.0, BW: 2.0, NM: 1.0, SW: 0.3, MS: 0.0 };
// 后2区概率（选择不影响结果——隐藏规则）
const PROB_GAMBLE = { W2: 0.45, L2: 0.55 };
const MULTI_GAMBLE = { W2: 2.0, L2: 0.0 };

// GET /api/alms/status - 化缘状态
router.get('/status', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT gold, daily_alms, alms_miss_streak, level FROM player_data WHERE user_id = ?',
      [req.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];

    // 计算解锁的区域
    const unlocked = {};
    for (const [id, cfg] of Object.entries(AREAS)) {
      unlocked[id] = {
        ...cfg,
        unlocked: p.gold >= cfg.threshold,
        threshold: cfg.threshold
      };
    }

    return success(res, {
      dailyAlms: p.daily_alms,
      gold: p.gold,
      missStreak: p.alms_miss_streak,
      areas: unlocked,
    }, '化缘状态');
  } catch (err) { next(err); }
});

// POST /api/alms/go - 执行化缘
router.post('/go', authMiddleware, async (req, res, next) => {
  try {
    const { area, mode } = req.body; // mode: 'safe' | 'risky'
    if (!area || !AREAS[area]) return fail(res, '无效的区域');
    if (!['safe', 'risky'].includes(mode)) return fail(res, '请选择稳求或险求');

    const cfg = AREAS[area];
    const isGamble = cfg.order >= 7; // 甘泽/流泉是赌博区

    // 查玩家数据
    const [rows] = await pool.query(
      'SELECT gold, daily_alms, alms_miss_streak FROM player_data WHERE user_id = ?',
      [req.userId]
    );
    if (rows.length === 0) return fail(res, '玩家数据不存在');
    const p = rows[0];

    if (p.daily_alms <= 0) return fail(res, '今日化缘次数已用完');
    if (p.gold < cfg.threshold) return fail(res, `金币不足 ${cfg.threshold}，无法进入${cfg.name}`);

    // 投入金额（门槛的10%）
    const stake = Math.floor(cfg.threshold * 0.1);
    if (p.gold < stake) return fail(res, `金币不足以投入 ${stake}`);

    // 计算结果
    let resultKey, multiplier, probTable;

    if (isGamble) {
      // 后2区：红黑对赌，选择不影响结果
      probTable = PROB_GAMBLE;
      resultKey = rollResult(probTable);
      multiplier = MULTI_GAMBLE[resultKey];
    } else {
      // 前6区
      probTable = mode === 'safe' ? PROB_SAFE : PROB_RISKY;

      // 连亏保护
      let adjustedProb = { ...probTable };
      if (p.alms_miss_streak >= 5) {
        // 5次连亏保底NM以上
        adjustedProb.MS = 0;
        adjustedProb.SW = 0;
        adjustedProb.NM = 0.50;
        adjustedProb.BW = 0.35;
        adjustedProb.JP = 0.15;
      } else if (p.alms_miss_streak >= 3) {
        // 3次连亏降低MS概率
        adjustedProb.MS = Math.max(0.02, adjustedProb.MS - 0.08);
        adjustedProb.NM += 0.08;
      }

      resultKey = rollResult(adjustedProb);
      multiplier = (mode === 'safe' ? MULTI_SAFE : MULTI_RISKY)[resultKey];
    }

    // 计算收益
    const payout = Math.floor(stake * multiplier);
    const netGain = payout - stake;
    const isMiss = resultKey === 'MS' || resultKey === 'L2';
    const newMissStreak = isMiss ? p.alms_miss_streak + 1 : 0;

    // 更新数据库
    await pool.query(
      `UPDATE player_data SET
        gold = gold + ?,
        daily_alms = daily_alms - 1,
        alms_miss_streak = ?
       WHERE user_id = ?`,
      [netGain, newMissStreak, req.userId]
    );

    // 记日志
    await pool.query(
      'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
      [req.userId, 'alms', JSON.stringify({
        area, mode, result: resultKey, stake, payout, netGain
      })]
    );

    // 结果名称映射
    const resultNames = {
      JP: '大吉', BW: '小吉', NM: '平', SW: '小亏', MS: '大凶',
      W2: '吉', L2: '凶'
    };

    return success(res, {
      area: cfg.name,
      areaId: area,
      mode,
      result: resultKey,
      resultName: resultNames[resultKey],
      stake,
      payout,
      netGain,
      remainAlms: p.daily_alms - 1,
      newGold: p.gold + netGain,
      missStreak: newMissStreak,
    }, `${cfg.name}化缘 —— ${resultNames[resultKey]}！`);

  } catch (err) { next(err); }
});

// GET /api/alms/history - 化缘记录
router.get('/history', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    const [rows] = await pool.query(
      `SELECT detail, created_at FROM logs
       WHERE user_id = ? AND action = 'alms'
       ORDER BY created_at DESC LIMIT ?`,
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
  // 兜底返回最后一个
  return Object.keys(probTable).pop();
}

module.exports = router;
