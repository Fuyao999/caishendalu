// ============================================
// 机器人管理路由
// ============================================
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/robots - 获取所有机器人
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, player_id, nickname, level, gold, reputation, 
              temple_storage, level, faith, fragments, mana,
              be_alms_count, has_shield, shield_end_at, disabled, created_at
       FROM robots ORDER BY player_id ASC`
    );
    
    // 处理护盾时间显示
    const now = Date.now();
    const data = rows.map(r => ({
      ...r,
      has_shield: r.has_shield || (r.shield_end_at > now ? 1 : 0),
      shield_remaining: r.shield_end_at > now 
        ? Math.ceil((r.shield_end_at - now) / 1000 / 60) 
        : 0
    }));
    
    return success(res, data);
  } catch (err) {
    return next(err);
  }
});

// GET /api/robots/:playerId - 获取单个机器人
router.get('/:playerId', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM robots WHERE player_id = ?`,
      [req.params.playerId]
    );
    if (rows.length === 0) return fail(res, '机器人不存在');
    return success(res, rows[0]);
  } catch (err) {
    return next(err);
  }
});

// POST /api/robots - 创建机器人
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const {
      player_id, nickname, level = 1, gold = 0, reputation = 0,
      temple_storage = 0, faith = 0, fragments = 0,
      mana = 100, be_alms_count = 0, has_shield = 0, shield_end_at = 0
    } = req.body;
    
    // 检查ID范围
    if (player_id < 900001 || player_id > 999999) {
      return fail(res, '机器人ID必须在900001-999999之间');
    }
    
    // 检查ID是否重复
    const [exist] = await pool.query('SELECT id FROM robots WHERE player_id = ?', [player_id]);
    if (exist.length > 0) return fail(res, '该机器人ID已存在');
    
    await pool.query(
      `INSERT INTO robots (player_id, nickname, level, gold, reputation, temple_storage, 
                           faith, fragments, mana, be_alms_count, has_shield, shield_end_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [player_id, nickname, level, gold, reputation, temple_storage, 
       faith, fragments, mana, be_alms_count, has_shield, shield_end_at]
    );
    
    return success(res, null, '机器人创建成功');
  } catch (err) {
    return next(err);
  }
});

// PUT /api/robots/:playerId - 更新机器人
router.put('/:playerId', authMiddleware, async (req, res, next) => {
  try {
    const {
      nickname, level, gold, reputation,
      temple_storage, faith, fragments,
      mana, be_alms_count, has_shield, shield_end_at, disabled
    } = req.body;
    
    const [exist] = await pool.query('SELECT id FROM robots WHERE player_id = ?', [req.params.playerId]);
    if (exist.length === 0) return fail(res, '机器人不存在');
    
    const updates = [];
    const values = [];
    
    if (nickname !== undefined) { updates.push('nickname = ?'); values.push(nickname); }
    if (level !== undefined) { updates.push('level = ?'); values.push(level); }
    if (gold !== undefined) { updates.push('gold = ?'); values.push(gold); }
    if (reputation !== undefined) { updates.push('reputation = ?'); values.push(reputation); }
    if (temple_storage !== undefined) { updates.push('temple_storage = ?'); values.push(temple_storage); }
    if (level !== undefined) { updates.push('level = ?'); values.push(level); }
    if (faith !== undefined) { updates.push('faith = ?'); values.push(faith); }
    if (fragments !== undefined) { updates.push('fragments = ?'); values.push(fragments); }
    if (mana !== undefined) { updates.push('mana = ?'); values.push(mana); }
    if (be_alms_count !== undefined) { updates.push('be_alms_count = ?'); values.push(be_alms_count); }
    if (has_shield !== undefined) { updates.push('has_shield = ?'); values.push(has_shield); }
    if (shield_end_at !== undefined) { updates.push('shield_end_at = ?'); values.push(shield_end_at); }
    if (disabled !== undefined) { updates.push('disabled = ?'); values.push(disabled); }
    
    if (updates.length === 0) return fail(res, '没有要更新的字段');
    
    values.push(req.params.playerId);
    await pool.query(
      `UPDATE robots SET ${updates.join(', ')} WHERE player_id = ?`,
      values
    );
    
    return success(res, null, '机器人更新成功');
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/robots/:playerId - 删除机器人
router.delete('/:playerId', authMiddleware, async (req, res, next) => {
  try {
    const [exist] = await pool.query('SELECT id FROM robots WHERE player_id = ?', [req.params.playerId]);
    if (exist.length === 0) return fail(res, '机器人不存在');
    
    await pool.query('DELETE FROM robots WHERE player_id = ?', [req.params.playerId]);
    return success(res, null, '机器人删除成功');
  } catch (err) {
    return next(err);
  }
});

// POST /api/robots/:playerId/collect - 收取香火钱（存储→钱包）
router.post('/:playerId/collect', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM robots WHERE player_id = ?', [req.params.playerId]);
    if (rows.length === 0) return fail(res, '机器人不存在');
    
    const robot = rows[0];
    const templeStorage = robot.temple_storage || 0;
    if (templeStorage <= 0) return fail(res, '存储为0，无需收取');
    
    // 存储→钱包
    const newGold = (robot.gold || 0) + templeStorage;
    
    await pool.query(
      'UPDATE robots SET gold = ?, temple_storage = 0, updated_at = NOW() WHERE player_id = ?',
      [newGold, req.params.playerId]
    );
    
    return success(res, { collected: templeStorage, newGold }, '收取成功');
  } catch (err) {
    return next(err);
  }
});

// POST /api/robots/:playerId/upgrade-temple - 升级庙宇（机器人直接升级，不扣金币）
router.post('/:playerId/upgrade-temple', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM robots WHERE player_id = ?', [req.params.playerId]);
    if (rows.length === 0) return fail(res, '机器人不存在');
    
    const robot = rows[0];
    const currentLevel = robot.level || 1;
    if (currentLevel >= 5) return fail(res, '已达最高等级');
    
    const newLevel = currentLevel + 1;
    // 存储上限：1级5000, 2级10000, 3级18000, 4级30000, 5级50000
    const storageLimits = { 2: 10000, 3: 18000, 4: 30000, 5: 50000 };
    const newStorageLimit = storageLimits[newLevel];
    
    await pool.query(
      'UPDATE robots SET level = ?, temple_storage = LEAST(temple_storage, ?) WHERE player_id = ?',
      [newLevel, newStorageLimit, req.params.playerId]
    );
    
    return success(res, { newLevel, newStorageLimit }, '升级成功');
  } catch (err) {
    return next(err);
  }
});

// POST /api/robots/:playerId/alms - 机器人主动化缘
router.post('/:playerId/alms', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM robots WHERE player_id = ?', [req.params.playerId]);
    if (rows.length === 0) return fail(res, '机器人不存在');
    
    const robot = rows[0];
    
    // 随机选一个目标：70%机器人 + 30%真实玩家
    const isRobotTarget = Math.random() < 0.7;
    let targets, target, actualAmount;
    
    if (isRobotTarget) {
      // 目标：其他机器人
      [targets] = await pool.query(
        'SELECT player_id, nickname, temple_storage, gold, level FROM robots WHERE player_id != ? ORDER BY RAND() LIMIT 1',
        [req.params.playerId]
      );
      if (targets.length === 0) return fail(res, '没有可化的缘');
      target = targets[0];
      const baseLimit = { 1: 500, 2: 1000, 3: 1800, 4: 3000, 5: 5000 };
      const almsAmount = Math.floor((baseLimit[robot.level] || 500) * (0.5 + Math.random() * 0.5));
      actualAmount = Math.min(almsAmount, target.temple_storage || 0);
      
      // 扣除目标存储，加到机器人
      await pool.query('UPDATE robots SET temple_storage = temple_storage - ? WHERE player_id = ?', [actualAmount, target.player_id]);
      await pool.query('UPDATE robots SET gold = gold + ? WHERE player_id = ?', [actualAmount, req.params.playerId]);
    } else {
      // 目标：真实玩家（从player_data表）
      [targets] = await pool.query(
        'SELECT user_id, player_id, nickname, gold, level FROM player_data ORDER BY RAND() LIMIT 1'
      );
      if (targets.length === 0) return fail(res, '没有可化的缘');
      target = targets[0];
      const baseLimit = { 1: 500, 2: 1000, 3: 1800, 4: 3000, 5: 5000 };
      const almsAmount = Math.floor((baseLimit[robot.level] || 500) * (0.5 + Math.random() * 0.5));
      // 真实玩家的庙宇存储用 level 估算
      const playerStorageLimit = 20 + (target.level || 1) * 10;
      actualAmount = Math.min(almsAmount, playerStorageLimit);
      
      // 扣除玩家香火钱，加到机器人
      await pool.query('UPDATE player_data SET gold = gold - ? WHERE user_id = ?', [actualAmount, target.user_id]);
      await pool.query('UPDATE robots SET gold = gold + ? WHERE player_id = ?', [actualAmount, req.params.playerId]);
    }
    
    return success(res, { target: target.nickname, amount: actualAmount, isRobot: isRobotTarget }, '化缘成功');
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/robots/:playerId - 删除机器人
router.delete('/:playerId', authMiddleware, async (req, res, next) => {
  try {
    const [exist] = await pool.query('SELECT id FROM robots WHERE player_id = ?', [req.params.playerId]);
    if (exist.length === 0) return fail(res, '机器人不存在');
    
    await pool.query('DELETE FROM robots WHERE player_id = ?', [req.params.playerId]);
    return success(res, null, '机器人删除成功');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
