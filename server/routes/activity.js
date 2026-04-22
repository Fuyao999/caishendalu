const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { pool } = require('../config/database');
const { success, fail } = require('../utils/helpers');

// 获取当前日期
function getToday() {
    return new Date().toISOString().split('T')[0];
}

// 获取当前周数（周一为开始）
function getWeekNumber() {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    return Math.floor(monday.getTime() / (7 * 24 * 60 * 60 * 1000));
}

// 初始化玩家活跃记录
async function initPlayerActivity(userId) {
    const [rows] = await pool.query('SELECT * FROM player_activity WHERE user_id = ?', [userId]);
    if (rows.length === 0) {
        await pool.query(
            'INSERT INTO player_activity (user_id, daily_activity, weekly_activity, daily_claimed, weekly_claimed, last_claim_date, last_week) VALUES (?, 0, 0, \'{}\', \'{}\', ?, ?)',
            [userId, getToday(), getWeekNumber()]
        );
    }
}

// 检查并重置每日/每周活跃
async function checkAndResetActivity(userId) {
    const today = getToday();
    const currentWeek = getWeekNumber();
    
    const [rows] = await pool.query('SELECT * FROM player_activity WHERE user_id = ?', [userId]);
    if (rows.length === 0) return;
    
    const player = rows[0];
    
    // 检查是否需要重置每日
    if (player.last_claim_date !== today) {
        await pool.query(
            'UPDATE player_activity SET daily_activity = 0, daily_claimed = \'{}\', last_claim_date = ? WHERE user_id = ?',
            [today, userId]
        );
    }
    
    // 检查是否需要重置每周
    if (player.last_week !== currentWeek) {
        await pool.query(
            'UPDATE player_activity SET weekly_activity = 0, weekly_claimed = \'{}\', last_week = ? WHERE user_id = ?',
            [currentWeek, userId]
        );
    }
}

// GET /api/activity/info - 获取活跃中心数据
router.get('/info', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        
        // 初始化并检查重置
        await initPlayerActivity(userId);
        await checkAndResetActivity(userId);
        
        // 获取每日任务列表
        const [tasks] = await pool.query(
            'SELECT * FROM quests WHERE type = \'daily\' AND is_active = 1 ORDER BY sort_order'
        );
        
        // 获取玩家任务进度
        const [progressRows] = await pool.query(
            'SELECT quest_id, progress, claimed FROM quest_progress WHERE user_id = ?',
            [userId]
        );
        const progressMap = {};
        progressRows.forEach(p => { progressMap[p.quest_id] = p; });
        
        // 构建任务列表（带完成状态）
        const taskList = tasks.map(task => {
            const p = progressMap[task.id] || { progress: 0, claimed: 0 };
            return {
                id: task.id,
                name: task.name,
                description: task.description,
                target_type: task.target_type,
                target_count: task.target_count,
                progress: p.progress || 0,
                claimed: p.claimed === 1,
                reward_gold: task.reward_gold,
                reward_merit: task.reward_merit,
                reward_fragment: task.reward_fragment,
                activity_point: task.activity_point,
                done: (p.progress || 0) >= task.target_count
            };
        });
        
        // 获取每日活跃奖励
        const [dailyRewards] = await pool.query(
            'SELECT * FROM daily_rewards WHERE is_active = 1 ORDER BY activity_point'
        );
        
        // 获取每周活跃奖励
        const [weeklyRewards] = await pool.query(
            'SELECT * FROM weekly_rewards WHERE is_active = 1 ORDER BY activity_point'
        );
        
        // 获取玩家活跃数据
        const [activityRows] = await pool.query(
            'SELECT * FROM player_activity WHERE user_id = ?',
            [userId]
        );
        const activity = activityRows[0] || { daily_activity: 0, weekly_activity: 0, daily_claimed: '{}', weekly_claimed: '{}' };
        
        // 解析已领取记录
        let dailyClaimed = {};
        let weeklyClaimed = {};
        try { dailyClaimed = JSON.parse(activity.daily_claimed || '{}'); } catch(e) {}
        try { weeklyClaimed = JSON.parse(activity.weekly_claimed || '{}'); } catch(e) {}
        
        // 构建奖励列表（带领取状态）
        const dailyRewardList = dailyRewards.map(r => ({
            id: r.id,
            activity_point: r.activity_point,
            reward_gold: r.reward_gold,
            reward_merit: r.reward_merit,
            reward_fragment: r.reward_fragment,
            reward_incense: r.reward_incense,
            reward_candle: r.reward_candle,
            reward_gold_paper: r.reward_gold_paper,
            reward_fruit: r.reward_fruit,
            reward_yuanbao: r.reward_yuanbao,
            claimed: dailyClaimed[r.id] === true,
            reached: activity.daily_activity >= r.activity_point
        }));
        
        const weeklyRewardList = weeklyRewards.map(r => ({
            id: r.id,
            activity_point: r.activity_point,
            reward_gold: r.reward_gold,
            reward_merit: r.reward_merit,
            reward_fragment: r.reward_fragment,
            reward_incense: r.reward_incense,
            reward_candle: r.reward_candle,
            reward_gold_paper: r.reward_gold_paper,
            reward_fruit: r.reward_fruit,
            reward_yuanbao: r.reward_yuanbao,
            reward_title: r.reward_title,
            claimed: weeklyClaimed[r.id] === true,
            reached: activity.weekly_activity >= r.activity_point
        }));
        
        return success(res, {
            tasks: taskList,
            daily_activity: activity.daily_activity,
            weekly_activity: activity.weekly_activity,
            daily_rewards: dailyRewardList,
            weekly_rewards: weeklyRewardList
        });
    } catch (err) { next(err); }
});

// POST /api/activity/claim-daily - 领取每日活跃奖励
router.post('/claim-daily', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { reward_id } = req.body;
        
        if (!reward_id) return fail(res, '请选择奖励');
        
        // 检查并重置
        await checkAndResetActivity(userId);
        
        // 获取奖励信息
        const [rewards] = await pool.query(
            'SELECT * FROM daily_rewards WHERE id = ? AND is_active = 1',
            [reward_id]
        );
        if (rewards.length === 0) return fail(res, '奖励不存在');
        const reward = rewards[0];
        
        // 获取玩家活跃数据
        const [activityRows] = await pool.query(
            'SELECT * FROM player_activity WHERE user_id = ?',
            [userId]
        );
        if (activityRows.length === 0) return fail(res, '活跃数据不存在');
        const activity = activityRows[0];
        
        // 检查是否达到活跃值要求
        if (activity.daily_activity < reward.activity_point) {
            return fail(res, '活跃值不足');
        }
        
        // 检查是否已领取
        let claimed = {};
        try { claimed = JSON.parse(activity.daily_claimed || '{}'); } catch(e) {}
        if (claimed[reward_id]) {
            return fail(res, '已领取过该奖励');
        }
        
        // 发放奖励
        const updateFields = [];
        const updateValues = [];
        if (reward.reward_gold > 0) { updateFields.push('gold = gold + ?'); updateValues.push(reward.reward_gold); }
        if (reward.reward_merit > 0) { updateFields.push('merit = merit + ?'); updateValues.push(reward.reward_merit); }
        if (reward.reward_fragment > 0) { updateFields.push('fragments = fragments + ?'); updateValues.push(reward.reward_fragment); }
        if (reward.reward_incense > 0) { updateFields.push('incense_sticks = incense_sticks + ?'); updateValues.push(reward.reward_incense); }
        if (reward.reward_candle > 0) { updateFields.push('candles = candles + ?'); updateValues.push(reward.reward_candle); }
        if (reward.reward_gold_paper > 0) { updateFields.push('gold_paper = gold_paper + ?'); updateValues.push(reward.reward_gold_paper); }
        if (reward.reward_fruit > 0) { updateFields.push('fruits = fruits + ?'); updateValues.push(reward.reward_fruit); }
        if (reward.reward_yuanbao > 0) { updateFields.push('yuanbao = yuanbao + ?'); updateValues.push(reward.reward_yuanbao); }
        
        if (updateFields.length > 0) {
            await pool.query(
                `UPDATE player_data SET ${updateFields.join(', ')} WHERE user_id = ?`,
                [...updateValues, userId]
            );
        }
        
        // 记录已领取
        claimed[reward_id] = true;
        await pool.query(
            'UPDATE player_activity SET daily_claimed = ? WHERE user_id = ?',
            [JSON.stringify(claimed), userId]
        );
        
        // 记录日志
        await pool.query(
            'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
            [userId, 'claim_daily_reward', JSON.stringify({ reward_id, activity_point: reward.activity_point })]
        );
        
        return success(res, {
            reward_id,
            activity_point: reward.activity_point
        }, '领取成功');
    } catch (err) { next(err); }
});

// POST /api/activity/claim-weekly - 领取每周活跃奖励
router.post('/claim-weekly', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { reward_id } = req.body;
        
        if (!reward_id) return fail(res, '请选择奖励');
        
        // 检查并重置
        await checkAndResetActivity(userId);
        
        // 获取奖励信息
        const [rewards] = await pool.query(
            'SELECT * FROM weekly_rewards WHERE id = ? AND is_active = 1',
            [reward_id]
        );
        if (rewards.length === 0) return fail(res, '奖励不存在');
        const reward = rewards[0];
        
        // 获取玩家活跃数据
        const [activityRows] = await pool.query(
            'SELECT * FROM player_activity WHERE user_id = ?',
            [userId]
        );
        if (activityRows.length === 0) return fail(res, '活跃数据不存在');
        const activity = activityRows[0];
        
        // 检查是否达到周活跃值要求
        if (activity.weekly_activity < reward.activity_point) {
            return fail(res, '周活跃值不足');
        }
        
        // 检查是否已领取
        let claimed = {};
        try { claimed = JSON.parse(activity.weekly_claimed || '{}'); } catch(e) {}
        if (claimed[reward_id]) {
            return fail(res, '已领取过该奖励');
        }
        
        // 发放奖励
        const updateFields = [];
        const updateValues = [];
        if (reward.reward_gold > 0) { updateFields.push('gold = gold + ?'); updateValues.push(reward.reward_gold); }
        if (reward.reward_merit > 0) { updateFields.push('merit = merit + ?'); updateValues.push(reward.reward_merit); }
        if (reward.reward_fragment > 0) { updateFields.push('fragments = fragments + ?'); updateValues.push(reward.reward_fragment); }
        if (reward.reward_incense > 0) { updateFields.push('incense_sticks = incense_sticks + ?'); updateValues.push(reward.reward_incense); }
        if (reward.reward_candle > 0) { updateFields.push('candles = candles + ?'); updateValues.push(reward.reward_candle); }
        if (reward.reward_gold_paper > 0) { updateFields.push('gold_paper = gold_paper + ?'); updateValues.push(reward.reward_gold_paper); }
        if (reward.reward_fruit > 0) { updateFields.push('fruits = fruits + ?'); updateValues.push(reward.reward_fruit); }
        if (reward.reward_yuanbao > 0) { updateFields.push('yuanbao = yuanbao + ?'); updateValues.push(reward.reward_yuanbao); }
        
        if (updateFields.length > 0) {
            await pool.query(
                `UPDATE player_data SET ${updateFields.join(', ')} WHERE user_id = ?`,
                [...updateValues, userId]
            );
        }
        
        // 记录已领取
        claimed[reward_id] = true;
        await pool.query(
            'UPDATE player_activity SET weekly_claimed = ? WHERE user_id = ?',
            [JSON.stringify(claimed), userId]
        );
        
        // 记录日志
        await pool.query(
            'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
            [userId, 'claim_weekly_reward', JSON.stringify({ reward_id, activity_point: reward.activity_point })]
        );
        
        return success(res, {
            reward_id,
            activity_point: reward.activity_point
        }, '领取成功');
    } catch (err) { next(err); }
});

// POST /api/activity/sync - 更新活跃值（内部调用）
router.post('/sync', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { task_type } = req.body;
        
        if (!task_type) return fail(res, '缺少任务类型');
        
        // 初始化并检查重置
        await initPlayerActivity(userId);
        await checkAndResetActivity(userId);
        
        // 根据任务类型计算活跃值
        const taskTypeMap = {
            'login': 'login_days',
            'sign': 'sign_days',
            'alms': 'alms_today',
            'alms_great': 'great_alms_today',
            'worship': 'worship_today',
            'visit': 'visit_today',
            'invite': 'invite_today',
            'share': 'share_today',
            'consume': 'consume_today'
        };
        
        const targetType = taskTypeMap[task_type];
        if (!targetType) return fail(res, '无效的任务类型');
        
        // 获取任务配置
        const [tasks] = await pool.query(
            'SELECT * FROM quests WHERE target_type = ? AND type = \'daily\' AND is_active = 1',
            [targetType]
        );
        
        if (tasks.length === 0) {
            return success(res, { activity: 0 }, '无对应任务');
        }
        
        const task = tasks[0];
        
        // 获取或创建任务进度
        const [progressRows] = await pool.query(
            'SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ?',
            [userId, task.id]
        );
        
        let currentProgress = 0;
        if (progressRows.length > 0) {
            currentProgress = progressRows[0].progress || 0;
        }
        
        // 更新进度
        currentProgress += 1;
        
        if (progressRows.length > 0) {
            await pool.query(
                'UPDATE quest_progress SET progress = ? WHERE user_id = ? AND quest_id = ?',
                [currentProgress, userId, task.id]
            );
        } else {
            await pool.query(
                'INSERT INTO quest_progress (user_id, quest_id, progress, claimed) VALUES (?, ?, ?, 0)',
                [userId, task.id, currentProgress]
            );
        }
        
        // 如果任务完成，更新活跃值
        let activityGained = 0;
        if (currentProgress >= task.target_count) {
            // 检查是否已经计算过活跃值（避免重复）
            if (progressRows.length === 0 || progressRows[0].progress < task.target_count) {
                activityGained = task.activity_point || 0;
                
                // 更新玩家活跃值
                await pool.query(
                    'UPDATE player_activity SET daily_activity = daily_activity + ?, weekly_activity = weekly_activity + ? WHERE user_id = ?',
                    [activityGained, activityGained, userId]
                );
            }
        }
        
        return success(res, {
            task_id: task.id,
            progress: currentProgress,
            target: task.target_count,
            activity_gained: activityGained,
            done: currentProgress >= task.target_count
        });
    } catch (err) { next(err); }
});

// POST /api/activity/share - 分享成功回调
router.post('/share', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        await initPlayerActivity(userId);
        await checkAndResetActivity(userId);

        // 更新分享任务进度
        const [shareTasks] = await pool.query(
            "SELECT * FROM quests WHERE target_type = 'share_today' AND type = 'daily' AND is_active = 1"
        );
        for (const task of shareTasks) {
            const [progressRows] = await pool.query(
                'SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ?',
                [userId, task.id]
            );
            let currentProgress = progressRows.length > 0 ? (progressRows[0].progress || 0) : 0;
            currentProgress += 1;
            if (progressRows.length > 0) {
                await pool.query(
                    'UPDATE quest_progress SET progress = ? WHERE user_id = ? AND quest_id = ?',
                    [currentProgress, userId, task.id]
                );
            } else {
                await pool.query(
                    'INSERT INTO quest_progress (user_id, quest_id, progress, claimed) VALUES (?, ?, ?, 0)',
                    [userId, task.id, currentProgress]
                );
            }
            // 更新活跃值
            if (currentProgress >= task.target_count) {
                if (progressRows.length === 0 || (progressRows[0].progress || 0) < task.target_count) {
                    await pool.query(
                        'UPDATE player_activity SET daily_activity = daily_activity + ?, weekly_activity = weekly_activity + ? WHERE user_id = ?',
                        [task.activity_point || 0, task.activity_point || 0, userId]
                    );
                }
            }
        }
        return success(res, { shared: true }, '分享成功');
    } catch (err) { next(err); }
});

module.exports = router;
