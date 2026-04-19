// ============================================
// 财神大陆 - 工具函数
// ============================================

// 统一成功响应
function success(res, data = null, message = '成功') {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json({ code: 200, message, data });
}

// 统一失败响应
function fail(res, message = '操作失败', code = 400) {
  return res.status(code >= 500 ? 500 : 400).json({ code, message });
}

// 随机整数 [min, max]
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 按权重随机选择
function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const item of items) {
    rand -= item.weight;
    if (rand <= 0) return item;
  }
  return items[items.length - 1];
}

// 境界计算 - 九重天境界体系（基于凡人修仙传 + 财神文化包装）
// 显示格式：传统境界·财神包装（如：炼气期·聚气生财）
// 1-5级为"孕灵"阶段，玩家=落入泥胎的灵识本身
const REALMS = [
  // === 第一阶段：孕灵 ===
  { level: 0,  name: '灵种入体',          minLevel: 1  },  // 破庙，一缕模糊灵识
  { level: 1,  name: '灵根初萌',          minLevel: 2  },  // 小庙，灵识稍清晰
  { level: 2,  name: '灵识渐明',          minLevel: 3  },  // 中庙，能感知外界
  { level: 3,  name: '灵体凝聚',          minLevel: 4  },  // 大庙，人形在泥胎内成形
  { level: 4,  name: '财源启灵',          minLevel: 5  },  // 金身庙，破壳！金光破体！
  
  // === 第二阶段：九重天 ===
  { level: 5,  name: '炼气期·聚气生财',   minLevel: 6  },  // 第一重：初入财域
  { level: 6,  name: '筑基期·筑财为基',   minLevel: 11 },  // 第二重：深入探索
  { level: 7,  name: '结丹期·凝结财丹',   minLevel: 21 },  // 第三重：精通财域
  { level: 8,  name: '元婴期·元财化婴',   minLevel: 31 },  // 第四重：高阶财域
  { level: 9,  name: '化神期·财神化神',   minLevel: 41 },  // 第五重：域主挑战
  { level: 10, name: '炼虚期·炼虚聚财',   minLevel: 51 },  // 第六重：虚空财域
  { level: 11, name: '合体期·合体生财',   minLevel: 61 },  // 第七重：财神合体
  { level: 12, name: '大乘期·大乘散财',   minLevel: 71 },  // 第八重：散财济世
  { level: 13, name: '真仙期·财道真仙',   minLevel: 81 },  // 第九重：册封财神（非渡劫！）
];

function getRealm(playerLevel) {
  for (let i = REALMS.length - 1; i >= 0; i--) {
    if (playerLevel >= REALMS[i].minLevel) return REALMS[i];
  }
  return REALMS[0];
}

// 升级经验公式
function expForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

// 化缘结果概率 (前6区)
const ALMS_PROBS = {
  safe:  { JP: 0.10, BW: 0.25, NM: 0.35, SW: 0.20, MS: 0.10 },
  risky: { JP: 0.20, BW: 0.15, NM: 0.20, SW: 0.20, MS: 0.25 },
};

// 化缘倍率
const ALMS_MULT = {
  safe:  { JP: 3.0, BW: 1.5, NM: 1.0, SW: 0.5, MS: 0.0 },
  risky: { JP: 5.0, BW: 2.0, NM: 1.0, SW: 0.3, MS: 0.0 },
};

// 8区门槛
const AREA_THRESHOLDS = {
  tianlu:   100,
  zhenyue:  500,
  longyin:  1000,
  fuyao:    5000,
  nanming:  10000,
  dibao:    50000,
  ganze:    77777,
  liquan:   99999,
};

// 后2区红黑概率
const RED_BLACK_PROB = { W2: 0.45, L2: 0.55 };

module.exports = {
  success, fail, randInt, weightedRandom,
  getRealm, expForLevel, REALMS,
  ALMS_PROBS, ALMS_MULT, AREA_THRESHOLDS, RED_BLACK_PROB,
};
