const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const INVITE_REWARD = {
    inviter: { gold: 500, fragments: 5, merit: 50 },     // 邀请方奖励
    invitee: { gold: 1000, fragments: 10, merit: 50 }   // 被邀请方奖励
};

// 生成邀请码
function generateInvitationCode() {
    return 'CS' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 绑定邀请码
router.post('/bind', authMiddleware, async (req, res) => {
    try {
        const { invitationCode } = req.body;
        const userId = req.user.userId;
        
        if (!invitationCode) {
            return res.status(400).json({ code: 400, message: '请输入邀请码' });
        }
        
        // 获取当前玩家的 player_id
        const [playerRows] = await db.pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (playerRows.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }
        
        const playerId = playerRows[0].player_id;
        
        // 查找邀请码对应的玩家
        const [invitees] = await db.pool.query(
            'SELECT id, player_id FROM player_data WHERE invitation_code = ?',
            [invitationCode]
        );
        
        if (invitees.length === 0) {
            return res.status(404).json({ code: 404, message: '邀请码不存在' });
        }
        
        const inviterPlayerId = invitees[0].player_id;
        
        if (inviterPlayerId === playerId) {
            return res.status(400).json({ code: 400, message: '不能绑定自己的邀请码' });
        }
        
        // 检查是否已经绑定过
        const [players] = await db.pool.query(
            'SELECT invited_by FROM player_data WHERE player_id = ?',
            [playerId]
        );
        
        if (players.length > 0 && players[0].invited_by) {
            return res.status(400).json({ code: 400, message: '已经绑定过邀请码' });
        }
        
        // 绑定邀请关系
        await db.pool.query(
            'UPDATE player_data SET invited_by = ? WHERE player_id = ?',
            [inviterPlayerId, playerId]
        );
        
        // 给被邀请方发奖励
        await db.pool.query(
            `UPDATE player_data SET 
                gold = gold + ?, 
                fragments = fragments + ?, 
                merit = merit + ? 
            WHERE player_id = ?`,
            [INVITE_REWARD.invitee.gold, INVITE_REWARD.invitee.fragments, INVITE_REWARD.invitee.merit, playerId]
        );
        
        // 记录被邀请方到邀请方的好友列表（通过 invited_friends 字段存储）
        // 这里简化处理，实际应该有一个好友关系表
        
        res.json({ code: 200, message: '绑定成功', data: INVITE_REWARD.invitee });
        
    } catch (error) {
        console.error('绑定邀请码错误:', error);
        res.status(500).json({ code: 500, message: '服务器错误: ' + error.message });
    }
});

// 获取邀请奖励状态
router.get('/status/:playerId', async (req, res) => {
    try {
        const { playerId } = req.params;
        
        const [players] = await db.pool.query(
            'SELECT invited_by, invitation_code FROM player_data WHERE player_id = ?',
            [playerId]
        );
        
        if (players.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }
        
        res.json({
            code: 200,
            data: {
                invitationCode: players[0].invitation_code,
                invitedBy: players[0].invited_by,
                rewardClaimed: !!players[0].invited_by
            }
        });
        
    } catch (error) {
        console.error('获取邀请状态错误:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 领取邀请奖励（邀请方）
router.post('/claim', async (req, res) => {
    try {
        const { playerId } = req.body;
        
        // 检查有多少未领取的好友
        // 实际需要一个 invited_friends 表来追踪，这里简化处理
        
        res.json({ code: 200, message: '领取成功' });
        
    } catch (error) {
        console.error('领取奖励错误:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
