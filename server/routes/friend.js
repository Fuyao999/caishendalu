const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 随机名字库
const NAMES = [
    '财源广进', '金玉满堂', '招财进宝', '福星高照', '万事如意',
    '生意兴隆', '富贵双全', '五福临门', '恭喜发财', '大吉大利',
    '财神保佑', '年年有余', '福禄双全', '金碧辉煌', '宝地生金',
    '紫气东来', '瑞雪兆丰', '春回大地', '万象更新', '欣欣向荣'
];

const LEVELS = [1, 2, 3, 4, 5];

// 获取好友列表
router.get('/list', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // 获取 player_id
        const [playerRows] = await db.pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (playerRows.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }
        
        const playerId = playerRows[0].player_id;
        
        // 获取好友列表
        const [friends] = await db.pool.query(
            'SELECT * FROM friends WHERE player_id = ? ORDER BY created_at DESC',
            [playerId]
        );
        
        res.json({
            code: 200,
            data: {
                friends: friends.map(f => ({
                    id: f.id,
                    friendId: f.friend_id,
                    name: f.friend_name,
                    level: f.friend_level,
                    visitCount: f.visit_count
                })),
                total: friends.length
            }
        });
        
    } catch (error) {
        console.error('获取好友列表失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 添加随机好友
router.post('/add', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // 获取 player_id
        const [playerRows] = await db.pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (playerRows.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }
        
        const playerId = playerRows[0].player_id;
        
        // 检查好友数量
        const [countResult] = await db.pool.query(
            'SELECT COUNT(*) as count FROM friends WHERE player_id = ?',
            [playerId]
        );
        
        if (countResult[0].count >= 20) {
            return res.status(400).json({ code: 400, message: '好友已满（最多20人）' });
        }
        
        // 生成随机好友
        const randomName = NAMES[Math.floor(Math.random() * NAMES.length)];
        const randomLevel = LEVELS[Math.floor(Math.random() * LEVELS.length)];
        const friendId = Math.floor(Math.random() * 10000) + 1000; // 模拟好友ID
        
        // 插入好友
        await db.pool.query(
            'INSERT INTO friends (player_id, friend_id, friend_name, friend_level, visit_count) VALUES (?, ?, ?, ?, 0)',
            [playerId, friendId, randomName, randomLevel]
        );
        
        res.json({
            code: 200,
            message: `添加好友 ${randomName} 成功！`,
            data: {
                friendId,
                name: randomName,
                level: randomLevel
            }
        });
        
    } catch (error) {
        console.error('添加好友失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 拜访好友
router.post('/visit/:friendId', authMiddleware, async (req, res) => {
    try {
        const { friendId } = req.params;
        const userId = req.user.userId;
        
        // 获取 player_id
        const [playerRows] = await db.pool.query(
            'SELECT player_id, visit_count FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (playerRows.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }
        
        const playerId = playerRows[0].player_id;
        const playerVisitCount = playerRows[0].visit_count || 0;
        
        // 检查拜访次数
        if (playerVisitCount >= 20) {
            return res.status(400).json({ code: 400, message: '今日拜访次数已用完（20/20）' });
        }
        
        // 检查好友是否存在
        const [friendRows] = await db.pool.query(
            'SELECT * FROM friends WHERE id = ? AND player_id = ?',
            [friendId, playerId]
        );
        
        if (friendRows.length === 0) {
            return res.status(404).json({ code: 404, message: '好友不存在' });
        }
        
        // 增加拜访次数
        await db.pool.query(
            'UPDATE player_data SET visit_count = visit_count + 1 WHERE user_id = ?',
            [userId]
        );
        
        // 增加好友的拜访计数
        await db.pool.query(
            'UPDATE friends SET visit_count = visit_count + 1 WHERE id = ?',
            [friendId]
        );
        
        // 增加玩家善缘和声望
        await db.pool.query(
            'UPDATE player_data SET merit = merit + 2, reputation = reputation + 1 WHERE user_id = ?',
            [userId]
        );
        
        const newVisitCount = playerVisitCount + 1;
        
        res.json({
            code: 200,
            message: `拜访${friendRows[0].friend_name}成功！善缘+2 声望+1`,
            data: {
                visitCount: newVisitCount,
                maxVisit: 20,
                meritGained: 2,
                reputationGained: 1
            }
        });
        
    } catch (error) {
        console.error('拜访好友失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 删除好友
router.delete('/:friendId', authMiddleware, async (req, res) => {
    try {
        const { friendId } = req.params;
        const userId = req.user.userId;
        
        // 获取 player_id
        const [playerRows] = await db.pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (playerRows.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }
        
        const playerId = playerRows[0].player_id;
        
        // 删除好友
        await db.pool.query(
            'DELETE FROM friends WHERE id = ? AND player_id = ?',
            [friendId, playerId]
        );
        
        res.json({
            code: 200,
            message: '删除成功'
        });
        
    } catch (error) {
        console.error('删除好友失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
