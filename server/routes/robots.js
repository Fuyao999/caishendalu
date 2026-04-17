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
              temple_storage, temple_level, faith, fragments, mana,
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
      temple_storage = 0, temple_level = 1, faith = 0, fragments = 0,
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
                           temple_level, faith, fragments, mana, be_alms_count, has_shield, shield_end_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [player_id, nickname, level, gold, reputation, temple_storage, temple_level, 
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
      temple_storage, temple_level, faith, fragments,
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
    if (temple_level !== undefined) { updates.push('temple_level = ?'); values.push(temple_level); }
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

module.exports = router;
