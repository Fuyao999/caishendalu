const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { pool } = require('../config/database');
const { success, fail } = require('../utils/helpers');

// ==================== 每日任务管理 ====================

// GET /api/admin/activity/tasks - 获取每日任务列表
router.get('/tasks', adminMiddleware, async (req, res, next) => {
    try {
        const [tasks] = await pool.query(
            'SELECT * FROM quests WHERE type = \'daily\' AND is_active = 1 ORDER BY sort_order'
        );
        return success(res, tasks);
    } catch (err) { next(err); }
});

// POST /api/admin/activity/tasks - 添加/编辑任务
router.post('/tasks', adminMiddleware, async (req, res, next) => {
    try {
        const { id, name, description, target_type, target_count, reward_gold, reward_merit, reward_fragment, activity_point, sort_order } = req.body;
        
        if (id) {
            // 更新
            await pool.query(
                `UPDATE quests SET name = ?, description = ?, target_type = ?, target_count = ?, 
                reward_gold = ?, reward_merit = ?, reward_fragment = ?, activity_point = ?, sort_order = ? WHERE id = ?`,
                [name, description, target_type, target_count, reward_gold, reward_merit, reward_fragment, activity_point, sort_order, id]
            );
            return success(res, { id }, '更新成功');
        } else {
            // 新增
            const newId = 'daily_' + Date.now();
            await pool.query(
                `INSERT INTO quests (id, type, name, description, target_type, target_count, reward_gold, reward_merit, reward_fragment, activity_point, sort_order, is_active) 
                VALUES (?, 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [newId, name, description, target_type, target_count, reward_gold, reward_merit, reward_fragment, activity_point, sort_order]
            );
            return success(res, { id: newId }, '添加成功');
        }
    } catch (err) { next(err); }
});

// DELETE /api/admin/activity/tasks/:id - 删除任务
router.delete('/tasks/:id', adminMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE quests SET is_active = 0 WHERE id = ?', [id]);
        return success(res, null, '删除成功');
    } catch (err) { next(err); }
});

// ==================== 每日活跃奖励管理 ====================

// GET /api/admin/activity/daily-rewards - 获取每日奖励列表
router.get('/daily-rewards', adminMiddleware, async (req, res, next) => {
    try {
        const [rewards] = await pool.query(
            'SELECT * FROM daily_rewards WHERE is_active = 1 ORDER BY activity_point'
        );
        return success(res, rewards);
    } catch (err) { next(err); }
});

// POST /api/admin/activity/daily-rewards - 添加/编辑每日奖励
router.post('/daily-rewards', adminMiddleware, async (req, res, next) => {
    try {
        const { id, activity_point, reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle, reward_gold_paper, reward_fruit, reward_yuanbao, sort_order } = req.body;
        
        if (id) {
            await pool.query(
                `UPDATE daily_rewards SET activity_point = ?, reward_gold = ?, reward_merit = ?, reward_fragment = ?,
                reward_incense = ?, reward_candle = ?, reward_gold_paper = ?, reward_fruit = ?, reward_yuanbao = ?, sort_order = ? WHERE id = ?`,
                [activity_point, reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle, reward_gold_paper, reward_fruit, reward_yuanbao, sort_order, id]
            );
            return success(res, { id }, '更新成功');
        } else {
            const [result] = await pool.query(
                `INSERT INTO daily_rewards (activity_point, reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle, reward_gold_paper, reward_fruit, reward_yuanbao, sort_order) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [activity_point, reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle, reward_gold_paper, reward_fruit, reward_yuanbao, sort_order]
            );
            return success(res, { id: result.insertId }, '添加成功');
        }
    } catch (err) { next(err); }
});

// DELETE /api/admin/activity/daily-rewards/:id - 删除每日奖励
router.delete('/daily-rewards/:id', adminMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE daily_rewards SET is_active = 0 WHERE id = ?', [id]);
        return success(res, null, '删除成功');
    } catch (err) { next(err); }
});

// ==================== 每周活跃奖励管理 ====================

// GET /api/admin/activity/weekly-rewards - 获取每周奖励列表
router.get('/weekly-rewards', adminMiddleware, async (req, res, next) => {
    try {
        const [rewards] = await pool.query(
            'SELECT * FROM weekly_rewards WHERE is_active = 1 ORDER BY activity_point'
        );
        return success(res, rewards);
    } catch (err) { next(err); }
});

// POST /api/admin/activity/weekly-rewards - 添加/编辑每周奖励
router.post('/weekly-rewards', adminMiddleware, async (req, res, next) => {
    try {
        const { id, activity_point, reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle, reward_gold_paper, reward_fruit, reward_yuanbao, reward_title, sort_order } = req.body;
        
        if (id) {
            await pool.query(
                `UPDATE weekly_rewards SET activity_point = ?, reward_gold = ?, reward_merit = ?, reward_fragment = ?,
                reward_incense = ?, reward_candle = ?, reward_gold_paper = ?, reward_fruit = ?, reward_yuanbao = ?, reward_title = ?, sort_order = ? WHERE id = ?`,
                [activity_point, reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle, reward_gold_paper, reward_fruit, reward_yuanbao, reward_title, sort_order, id]
            );
            return success(res, { id }, '更新成功');
        } else {
            const [result] = await pool.query(
                `INSERT INTO weekly_rewards (activity_point, reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle, reward_gold_paper, reward_fruit, reward_yuanbao, reward_title, sort_order) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [activity_point, reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle, reward_gold_paper, reward_fruit, reward_yuanbao, reward_title, sort_order]
            );
            return success(res, { id: result.insertId }, '添加成功');
        }
    } catch (err) { next(err); }
});

// DELETE /api/admin/activity/weekly-rewards/:id - 删除每周奖励
router.delete('/weekly-rewards/:id', adminMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE weekly_rewards SET is_active = 0 WHERE id = ?', [id]);
        return success(res, null, '删除成功');
    } catch (err) { next(err); }
});

module.exports = router;
