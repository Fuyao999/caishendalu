// ============================================
// 宠物/灵兽路由 - 查看/获取/升级/出战
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/pets - 我的灵兽列表
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM pets WHERE user_id = ? ORDER BY is_active DESC, level DESC',
      [req.userId]
    );
    return success(res, rows, '灵兽列表');
  } catch (err) { next(err); }
});

// GET /api/pets/:id - 灵兽详情
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM pets WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (rows.length === 0) return fail(res, '灵兽不存在');
    return success(res, rows[0], '灵兽详情');
  } catch (err) { next(err); }
});

// POST /api/pets/summon - 召唤灵兽（抽卡/孵化）
router.post('/summon', authMiddleware, async (req, res, next) => {
  try {
    const cost = 5000;
    const [player] = await pool.query(
      'SELECT gold FROM player_data WHERE user_id = ?', [req.userId]
    );
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    // 灵兽池
    const petPool = [
      { type: '招财猫', quality: 1, hp: 50, atk: 8, def: 3, skill: '招财术' },
      { type: '金蟾', quality: 2, hp: 60, atk: 10, def: 5, skill: '吐宝术' },
      { type: '貔貅', quality: 3, hp: 80, atk: 15, def: 8, skill: '吞金术' },
      { type: '麒麟', quality: 4, hp: 120, atk: 25, def: 15, skill: '祥瑞降临' },
      { type: '九尾灵狐', quality: 3, hp: 70, atk: 20, def: 6, skill: '魅惑术' },
      { type: '赤焰凤', quality: 4, hp: 100, atk: 30, def: 10, skill: '浴火重生' },
      { type: '玄武龟', quality: 2, hp: 100, atk: 5, def: 20, skill: '龟甲护盾' },
      { type: '白泽', quality: 5, hp: 150, atk: 35, def: 20, skill: '知命术' },
    ];

    // 按品质概率抽取 (1白50% 2绿25% 3蓝15% 4紫8% 5橙2%)
    const rand = Math.random();
    let targetQuality;
    if (rand < 0.02) targetQuality = 5;
    else if (rand < 0.10) targetQuality = 4;
    else if (rand < 0.25) targetQuality = 3;
    else if (rand < 0.50) targetQuality = 2;
    else targetQuality = 1;

    const candidates = petPool.filter(p => p.quality === targetQuality);
    if (candidates.length === 0) {
      // 如果该品质没有候选，降级
      const fallback = petPool.filter(p => p.quality <= targetQuality);
      candidates.push(fallback[Math.floor(Math.random() * fallback.length)]);
    }
    const pet = candidates[Math.floor(Math.random() * candidates.length)];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      const [result] = await conn.query(
        `INSERT INTO pets (user_id, pet_type, name, level, quality, hp, atk, def, skill_1)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [req.userId, pet.type, pet.type, pet.quality, pet.hp, pet.atk, pet.def, pet.skill]
      );
      await conn.commit();

      const qualityNames = { 1: '白', 2: '绿', 3: '蓝', 4: '紫', 5: '橙' };
      return success(res, {
        petId: result.insertId,
        ...pet,
        qualityName: qualityNames[pet.quality],
      }, `召唤成功！获得【${qualityNames[pet.quality]}】${pet.type}！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/pets/activate - 出战/收回灵兽
router.post('/activate', authMiddleware, async (req, res, next) => {
  try {
    const { petId } = req.body;
    if (!petId) return fail(res, '请指定灵兽');

    const [pet] = await pool.query(
      'SELECT * FROM pets WHERE id = ? AND user_id = ?', [petId, req.userId]
    );
    if (pet.length === 0) return fail(res, '灵兽不存在');

    if (pet[0].is_active) {
      // 收回
      await pool.query('UPDATE pets SET is_active = 0 WHERE id = ?', [petId]);
      return success(res, null, `${pet[0].name} 已收回`);
    }

    // 先收回当前出战的
    await pool.query('UPDATE pets SET is_active = 0 WHERE user_id = ? AND is_active = 1', [req.userId]);
    await pool.query('UPDATE pets SET is_active = 1 WHERE id = ?', [petId]);
    return success(res, null, `${pet[0].name} 出战！`);
  } catch (err) { next(err); }
});

// POST /api/pets/feed - 喂养灵兽（升级）
router.post('/feed', authMiddleware, async (req, res, next) => {
  try {
    const { petId } = req.body;
    if (!petId) return fail(res, '请指定灵兽');

    const [pet] = await pool.query(
      'SELECT * FROM pets WHERE id = ? AND user_id = ?', [petId, req.userId]
    );
    if (pet.length === 0) return fail(res, '灵兽不存在');

    const maxLevel = pet[0].quality * 20; // 品质*20为等级上限
    if (pet[0].level >= maxLevel) return fail(res, '已达等级上限');

    const cost = pet[0].level * 200;
    const [player] = await pool.query('SELECT gold FROM player_data WHERE user_id = ?', [req.userId]);
    if (player[0].gold < cost) return fail(res, `金币不足，需要 ${cost}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [cost, req.userId]);
      await conn.query(
        'UPDATE pets SET level = level + 1, hp = hp + 5, atk = atk + 2, def = def + 1, intimacy = intimacy + 10 WHERE id = ?',
        [petId]
      );
      await conn.commit();
      return success(res, { newLevel: pet[0].level + 1, cost }, `${pet[0].name} 升级了！`);
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// POST /api/pets/rename - 重命名灵兽
router.post('/rename', authMiddleware, async (req, res, next) => {
  try {
    const { petId, name } = req.body;
    if (!petId || !name) return fail(res, '请指定灵兽和新名字');
    if (name.length > 32) return fail(res, '名字最长32个字符');

    const [pet] = await pool.query(
      'SELECT id FROM pets WHERE id = ? AND user_id = ?', [petId, req.userId]
    );
    if (pet.length === 0) return fail(res, '灵兽不存在');

    await pool.query('UPDATE pets SET name = ? WHERE id = ?', [name, petId]);
    return success(res, null, '重命名成功');
  } catch (err) { next(err); }
});

module.exports = router;
