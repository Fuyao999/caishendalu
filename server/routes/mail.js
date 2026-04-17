const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 模拟邮件数据
const SYSTEM_MAILS = [
    {
        id: 1,
        title: '🎁 新手礼包',
        content: '欢迎加入财神大陆！请查收新手礼包。',
        rewards: { gold: 1000, fragments: 5 },
        date: '2026-04-15',
        claimed: false
    },
    {
        id: 2,
        title: '📢 系统维护补偿',
        content: '由于系统维护，特发放补偿奖励。',
        rewards: { merit: 50, incense_sticks: 3 },
        date: '2026-04-15',
        claimed: false
    }
];

// 获取邮件列表
router.get('/list', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // 获取玩家已领取的邮件ID
        const [playerRows] = await db.pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (playerRows.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }
        
        const playerId = playerRows[0].player_id;
        
        // 获取玩家已领取的邮件ID列表
        const [claimedRows] = await db.pool.query(
            'SELECT mail_id FROM mail_claims WHERE player_id = ?',
            [playerId]
        );
        
        const claimedMailIds = claimedRows.map(r => r.mail_id);
        
        // 合并系统邮件和玩家邮件
        const allMails = SYSTEM_MAILS.map(mail => ({
            ...mail,
            claimed: claimedMailIds.includes(mail.id)
        }));
        
        // 获取未读数量
        const unreadCount = allMails.filter(m => !m.claimed).length;
        
        res.json({
            code: 200,
            data: {
                mails: allMails,
                unreadCount: unreadCount
            }
        });
        
    } catch (error) {
        console.error('获取邮件列表失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 领取邮件奖励
router.post('/claim/:mailId', authMiddleware, async (req, res) => {
    try {
        const { mailId } = req.params;
        const userId = req.user.userId;
        
        // 获取玩家信息
        const [playerRows] = await db.pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (playerRows.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }
        
        const playerId = playerRows[0].player_id;
        
        // 检查是否已领取
        const [claimedRows] = await db.pool.query(
            'SELECT * FROM mail_claims WHERE player_id = ? AND mail_id = ?',
            [playerId, mailId]
        );
        
        if (claimedRows.length > 0) {
            return res.status(400).json({ code: 400, message: '该邮件已领取' });
        }
        
        // 查找邮件
        const mail = SYSTEM_MAILS.find(m => m.id === parseInt(mailId));
        if (!mail) {
            return res.status(404).json({ code: 404, message: '邮件不存在' });
        }
        
        // 发放奖励
        if (mail.rewards.gold) {
            await db.pool.query(
                'UPDATE player_data SET gold = gold + ? WHERE user_id = ?',
                [mail.rewards.gold, userId]
            );
        }
        if (mail.rewards.fragments) {
            await db.pool.query(
                'UPDATE player_data SET fragments = fragments + ? WHERE user_id = ?',
                [mail.rewards.fragments, userId]
            );
        }
        if (mail.rewards.merit) {
            await db.pool.query(
                'UPDATE player_data SET merit = merit + ? WHERE user_id = ?',
                [mail.rewards.merit, userId]
            );
        }
        if (mail.rewards.incense_sticks) {
            await db.pool.query(
                'UPDATE player_data SET incense_sticks = incense_sticks + ? WHERE user_id = ?',
                [mail.rewards.incense_sticks, userId]
            );
        }
        if (mail.rewards.candles) {
            await db.pool.query(
                'UPDATE player_data SET candles = candles + ? WHERE user_id = ?',
                [mail.rewards.candles, userId]
            );
        }
        
        // 记录已领取
        await db.pool.query(
            'INSERT INTO mail_claims (player_id, mail_id) VALUES (?, ?)',
            [playerId, mailId]
        );
        
        res.json({
            code: 200,
            message: '领取成功！',
            data: {
                rewards: mail.rewards
            }
        });
        
    } catch (error) {
        console.error('领取邮件奖励失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
