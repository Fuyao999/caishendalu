const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取任务列表（玩家用）
router.get('/list', authMiddleware, async (req, res, next) => {
    try {
        const playerId = req.playerId;
        
        // 获取所有启用的任务
        const [quests] = await pool.query(
            'SELECT * FROM quests WHERE is_active = 1 ORDER BY type, sort_order'
        );
        
        // 获取玩家进度
        const [progress] = await pool.query(
            'SELECT quest_id, progress, claimed FROM player_quest_progress WHERE player_id = ?',
            [playerId]
        );
        
        // 转换进度为map
        const progressMap = {};
        progress.forEach(p => {
            progressMap[p.quest_id] = p;
        });
        
        // 获取玩家称号
        const [playerTitles] = await pool.query(
            'SELECT title_id, unlocked_at FROM player_titles WHERE user_id = ? AND unlocked_at IS NOT NULL',
            [playerId]
        );
        
        const equippedTitle = null; // 暂时不支持多装备
        
        // 获取已解锁的称号数量
        const unlockedTitles = playerTitles.filter(t => t.unlocked_at !== null).map(t => t.title_id);
        
        // 获取玩家数据（用于计算进度）
        const [players] = await pool.query(
            'SELECT * FROM player_data WHERE player_id = ?',
            [playerId]
        );
        
        if (!players.length) {
            return res.json({ code: 404, message: '玩家不存在' });
        }
        
        const player = players[0];
        
        // 组装任务数据
        const result = quests.map(quest => {
            const p = progressMap[quest.id] || { progress: 0, claimed: 0 };
            const currentProgress = calculateProgress(quest.target_type, quest.target_count, player, unlockedTitles.length);
            
            return {
                id: quest.id,
                title_id: quest.title_id,
                type: quest.type,
                name: quest.name,
                description: quest.description,
                target_type: quest.target_type,
                target_count: quest.target_count,
                progress: p.progress || currentProgress,
                claimed: p.claimed === 1,
                done: (p.progress || currentProgress) >= quest.target_count,
                reward: {
                    gold: quest.reward_gold,
                    merit: quest.reward_merit,
                    fragment: quest.reward_fragment,
                    incense: quest.reward_incense,
                    candle: quest.reward_candle,
                    gold_paper: quest.reward_gold_paper,
                    fruit: quest.reward_fruit,
                    yuanbao: quest.reward_yuanbao
                }
            };
        });
        
        res.json({
            code: 200,
            data: {
                quests: result,
                equipped_title: equippedTitle
            }
        });
    } catch(e) {
        next(e);
    }
});

// 获取每日任务
router.get('/daily', authMiddleware, async (req, res, next) => {
    try {
        const playerId = req.playerId;
        
        const [quests] = await pool.query(
            "SELECT * FROM quests WHERE type = 'daily' AND is_active = 1 ORDER BY sort_order"
        );
        
        const [progress] = await pool.query(
            'SELECT quest_id, progress, claimed FROM player_quest_progress WHERE player_id = ?',
            [playerId]
        );
        
        const progressMap = {};
        progress.forEach(p => {
            progressMap[p.quest_id] = p;
        });
        
        const [players] = await pool.query(
            'SELECT * FROM player_data WHERE player_id = ?',
            [playerId]
        );
        
        if (!players.length) {
            return res.json({ code: 404, message: '玩家不存在' });
        }
        
        const player = players[0];
        
        const result = quests.map(quest => {
            const p = progressMap[quest.id] || { progress: 0, claimed: 0 };
            const currentProgress = calculateProgress(quest.target_type, quest.target_count, player, 0);
            
            return {
                id: quest.id,
                type: quest.type,
                name: quest.name,
                description: quest.description,
                target_type: quest.target_type,
                target_count: quest.target_count,
                progress: p.progress || currentProgress,
                claimed: p.claimed === 1,
                done: (p.progress || currentProgress) >= quest.target_count,
                reward: {
                    gold: quest.reward_gold,
                    merit: quest.reward_merit,
                    fragment: quest.reward_fragment,
                    incense: quest.reward_incense,
                    candle: quest.reward_candle,
                    gold_paper: quest.reward_gold_paper,
                    fruit: quest.reward_fruit,
                    yuanbao: quest.reward_yuanbao
                }
            };
        });
        
        res.json({ code: 200, data: result });
    } catch(e) {
        next(e);
    }
});

// 获取某个称号的任务步骤
router.get('/by-title/:titleId', authMiddleware, async (req, res, next) => {
    try {
        const playerId = req.playerId;
        const { titleId } = req.params;
        
        // 获取该称号的5个任务
        const [quests] = await pool.query(
            "SELECT * FROM quests WHERE title_id = ? AND type = 'achievement' AND is_active = 1 ORDER BY sort_order",
            [titleId]
        );
        
        // 获取玩家进度
        const [progress] = await pool.query(
            'SELECT quest_id, progress, claimed FROM player_quest_progress WHERE player_id = ?',
            [playerId]
        );
        
        const progressMap = {};
        progress.forEach(p => {
            progressMap[p.quest_id] = p;
        });
        
        // 获取玩家当前属性
        const [players] = await pool.query(
            'SELECT * FROM player_data WHERE player_id = ?',
            [playerId]
        );
        
        const player = players[0] || {};
        
        // 获取已解锁的称号数量
        const [titles] = await pool.query(
            'SELECT COUNT(*) as cnt FROM player_titles WHERE user_id = ? AND unlocked_at IS NOT NULL',
            [playerId]
        );
        const unlockedTitleCount = titles[0]?.cnt || 0;
        
        // 获取已解锁的财神数量（从player_data的deity_order字段估算）
        let unlockedGodCount = 0;
        if (player.deity_order) {
            try {
                const deityOrder = JSON.parse(player.deity_order);
                unlockedGodCount = Array.isArray(deityOrder) ? deityOrder.length : 0;
            } catch(e) {
                unlockedGodCount = 0;
            }
        }
        
        const result = quests.map((quest, index) => {
            const p = progressMap[quest.id] || { progress: 0, claimed: 0 };
            
            // 计算当前进度
            let currentProgress = 0;
            if (quest.target_type === 'title_count') {
                currentProgress = unlockedTitleCount;
            } else if (quest.target_type === 'god_count') {
                currentProgress = unlockedGodCount;
            } else if (quest.target_type === 'level') {
                currentProgress = player.level || 1;
            } else if (quest.target_type === 'gold') {
                currentProgress = player.gold || 0;
            } else if (quest.target_type === 'merit') {
                currentProgress = player.merit || 0;
            } else if (quest.target_type === 'great_count') {
                currentProgress = player.great_count || 0;
            } else if (quest.target_type === 'login_days') {
                currentProgress = player.total_sign || 0;
            } else if (quest.target_type === 'worship_count') {
                currentProgress = player.worship_count || 0;
            } else if (quest.target_type === 'visit_count') {
                currentProgress = player.visit_count || 0;
            } else if (quest.target_type === 'total_spent') {
                currentProgress = player.total_spent || 0;
            } else if (quest.target_type === 'invite_count') {
                currentProgress = player.invite_count || 0;
            } else if (quest.target_type === 'total_recharge') {
                currentProgress = player.total_recharge || 0;
            }
            
            const completed = currentProgress >= quest.target_count;
            
            return {
                id: quest.id,
                step: index + 1,
                name: quest.name,
                description: quest.description,
                target: quest.target_count,
                progress: Math.min(currentProgress, quest.target_count),
                completed: completed,
                claimed: p.claimed === 1
            };
        });
        
        res.json({ code: 200, data: { quests: result } });
    } catch(e) {
        next(e);
    }
});

// 领取任务奖励
router.post('/claim', authMiddleware, async (req, res, next) => {
    try {
        const playerId = req.playerId;
        console.log('=== CLAIM DEBUG ===');
        console.log('req.playerId:', req.playerId);
        console.log('req.userId:', req.userId);
        console.log('req.body:', req.body);
        
        const { quest_id } = req.body;
        
        if (!quest_id) {
            return res.json({ code: 400, message: '缺少任务ID' });
        }
        
        // 获取任务
        const [quests] = await pool.query(
            'SELECT * FROM quests WHERE id = ? AND is_active = 1',
            [quest_id]
        );
        
        if (!quests.length) {
            return res.json({ code: 404, message: '任务不存在' });
        }
        
        const quest = quests[0];
        
        // 获取玩家进度
        const [progress] = await pool.query(
            'SELECT * FROM player_quest_progress WHERE player_id = ? AND quest_id = ?',
            [playerId, quest_id]
        );
        
        // 获取玩家数据
        const [players] = await pool.query(
            'SELECT * FROM player_data WHERE player_id = ?',
            [playerId]
        );
        
        if (!players.length) {
            return res.json({ code: 404, message: '玩家不存在' });
        }
        
        const player = players[0];
        
        // 计算当前进度
        const currentProgress = calculateProgress(quest.target_type, quest.target_count, player, 0);
        
        if (currentProgress < quest.target_count) {
            return res.json({ code: 400, message: '任务未完成' });
        }
        
        // 检查是否已领取
        if (progress.length && progress[0].claimed === 1) {
            return res.json({ code: 400, message: '奖励已领取' });
        }
        
        // 发放奖励
        const updates = [];
        const values = [];
        
        if (quest.reward_gold > 0) {
            updates.push('gold = gold + ?');
            values.push(quest.reward_gold);
        }
        if (quest.reward_merit > 0) {
            updates.push('merit = merit + ?');
            values.push(quest.reward_merit);
        }
        if (quest.reward_fragment > 0) {
            updates.push('fragments = fragments + ?');
            values.push(quest.reward_fragment);
        }
        if (quest.reward_incense > 0) {
            updates.push('incense_sticks = incense_sticks + ?');
            values.push(quest.reward_incense);
        }
        if (quest.reward_candle > 0) {
            updates.push('candles = candles + ?');
            values.push(quest.reward_candle);
        }
        if (quest.reward_gold_paper > 0) {
            updates.push('gold_paper = gold_paper + ?');
            values.push(quest.reward_gold_paper);
        }
        if (quest.reward_fruit > 0) {
            updates.push('fruits = fruits + ?');
            values.push(quest.reward_fruit);
        }
        if (quest.reward_yuanbao > 0) {
            updates.push('yuanbao = yuanbao + ?');
            values.push(quest.reward_yuanbao);
        }
        
        if (updates.length > 0) {
            values.push(playerId);
            await pool.query(
                'UPDATE player_data SET ' + updates.join(', ') + ' WHERE player_id = ?',
                values
            );
        }
        
        // 更新或插入进度
        if (progress.length) {
            await pool.query(
                'UPDATE player_quest_progress SET claimed = 1, claimed_at = NOW(), progress = ? WHERE player_id = ? AND quest_id = ?',
                [quest.target_count, playerId, quest_id]
            );
        } else {
            await pool.query(
                'INSERT INTO player_quest_progress (player_id, quest_id, progress, claimed, claimed_at) VALUES (?, ?, ?, 1, NOW())',
                [playerId, quest_id, quest.target_count]
            );
        }
        
        // 如果是成就任务，检查是否解锁称号
        if (quest.type === 'achievement' && quest.title_id) {
            await checkAndUnlockTitle(playerId, quest.title_id);
        }
        
        // 获取更新后的玩家数据
        const [updatedPlayer] = await pool.query(
            'SELECT * FROM player_data WHERE player_id = ?',
            [playerId]
        );
        
        res.json({
            code: 200,
            message: '领取成功',
            data: {
                reward: {
                    gold: quest.reward_gold,
                    merit: quest.reward_merit,
                    fragment: quest.reward_fragment,
                    incense: quest.reward_incense,
                    candle: quest.reward_candle
                },
                player: updatedPlayer[0]
            }
        });
    } catch(e) {
        next(e);
    }
});

// 获取称号列表
router.get('/titles', authMiddleware, async (req, res, next) => {
    try {
        const playerId = req.playerId;
        
        const [titles] = await pool.query(
            'SELECT * FROM titles WHERE is_active = 1 ORDER BY sort_order'
        );
        
        const [playerTitles] = await pool.query(
            'SELECT * FROM player_titles WHERE user_id = ?',
            [playerId]
        );
        
        const playerTitleMap = {};
        playerTitles.forEach(pt => {
            playerTitleMap[pt.title_id] = pt;
        });
        
        const equippedTitle = null; // 暂时不支持多装备
        
        const result = titles.map(title => {
            const pt = playerTitleMap[title.id];
            return {
                ...title,
                unlocked: pt ? true : false,  // 有记录就当解锁
                equipped: false
            };
        });
        
        res.json({
            code: 200,
            data: {
                titles: result,
                equipped_title: equippedTitle
            }
        });
    } catch(e) {
        next(e);
    }
});

// 装备/卸下称号
router.post('/titles/equip', authMiddleware, async (req, res, next) => {
    try {
        const playerId = req.playerId;
        const { title_id } = req.body;
        
        if (!title_id) {
            return res.json({ code: 400, message: '缺少称号ID' });
        }
        
        // 检查称号是否已解锁
        const [playerTitles] = await pool.query(
            'SELECT * FROM player_titles WHERE user_id = ? AND title_id = ?',
            [playerId, title_id]
        );
        
        if (!playerTitles.length || !playerTitles[0].unlocked_at) {
            return res.json({ code: 400, message: '称号未解锁' });
        }
        
        res.json({ code: 200, message: '装备成功' });
    } catch(e) {
        next(e);
    }
});

// 计算进度
function calculateProgress(targetType, targetCount, player, titleCount) {
    switch(targetType) {
        case 'login_days':
            return player.total_sign || 0;
        case 'alms_today':
            return player.alms_today || 0;
        case 'worship_today':
            return player.worship_count || 0;
        case 'bushu_today':
            return (player.bushushort_small || 0) + (player.bushushort_medium || 0) + (player.bushushort_large || 0);
        case 'total_spent':
            return player.gold || 0;
        case 'invite_count':
            return player.invited_by ? 1 : 0; // 需要实际字段
        case 'worship_count':
            return player.worship_count || 0;
        case 'total_recharge':
            return 0; // 需要充值记录表
        case 'merit':
            return player.merit || 0;
        case 'level':
            return player.level || 1;
        case 'crit_count':
            return player.great_count || 0;
        case 'max_gold':
            return player.gold || 0;
        case 'visit_count':
            return player.visit_count || 0;
        case 'god_count':
            return player.deity_order ? player.deity_order.split(',').length : 0;
        case 'title_count':
            return titleCount;
        default:
            return 0;
    }
}

// 检查并解锁称号
async function checkAndUnlockTitle(playerId, titleId) {
    // 检查该称号的所有任务是否完成
    const [tasks] = await pool.query(
        'SELECT * FROM quests WHERE title_id = ? AND is_active = 1',
        [titleId]
    );
    
    if (!tasks.length) return;
    
    const [progress] = await pool.query(
        'SELECT quest_id, claimed FROM player_quest_progress WHERE player_id = ?',
        [playerId]
    );
    
    const progressMap = {};
    progress.forEach(p => {
        progressMap[p.quest_id] = p;
    });
    
    // 所有任务都已领取
    const allCompleted = tasks.every(task => {
        const p = progressMap[task.id];
        return p && p.claimed === 1;
    });
    
    if (allCompleted) {
        // 解锁称号
        const [existing] = await pool.query(
            'SELECT * FROM player_titles WHERE user_id = ? AND title_id = ?',
            [playerId, titleId]
        );
        
        if (existing.length) {
            await pool.query(
                'UPDATE player_titles SET unlocked_at = NOW() WHERE user_id = ? AND title_id = ?',
                [playerId, titleId]
            );
        } else {
            await pool.query(
                'INSERT INTO player_titles (user_id, title_id, unlocked_at) VALUES (?, ?, NOW())',
                [playerId, titleId]
            );
        }
    }
}

module.exports = router;
