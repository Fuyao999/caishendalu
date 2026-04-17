const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 称号数据
const TITLES_DATA = [
    { id: 'yingcaishen', name: '迎财神', desc: '初来乍到，喜迎财神', bonus: '香火钱产出+5%' },
    { id: 'sancaizinv', name: '散财童子', desc: '广结善缘，散财积福', bonus: '善缘获取+20%' },
    { id: 'zhaocaitongzinv', name: '招财童子', desc: '招朋引伴，财气双收', bonus: '化缘收益+15%' },
    { id: 'nazhentianshen', name: '纳珍天尊', desc: '虔诚供奉，珍宝纳福', bonus: '碎片获取+20%' },
    { id: 'lishixianguan', name: '利市仙官', desc: '鸿运当头，利市三倍', bonus: '暴击率+5%' },
    { id: 'jinbaotianshen', name: '进宝天尊', desc: '积德行善，福报进宝', bonus: '功德获取+15%' },
    { id: 'wucaishen', name: '武财神', desc: '威震八方，财运亨通', bonus: '全资源产出+8%' },
    { id: 'piancaishen', name: '偏财神', desc: '偏财入库，意外之喜', bonus: '暴击伤害+25%' },
    { id: 'zhengcaishen', name: '正财神', desc: '正财稳固，基业长青', bonus: '香火钱上限+1000' },
    { id: 'wencaishen', name: '文财神', desc: '智慧生财，谋略过人', bonus: '每日首次供奉双倍' },
    { id: 'jubaotiangong', name: '聚宝天官', desc: '聚宝盆满，财神归位', bonus: '全属性+10%' },
    { id: 'caishenye', name: '财神爷', desc: '万神之主，财源之主', bonus: '全属性+25%' }
];

// 获取称号列表
router.get('/list', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        // 获取玩家已解锁的称号
        const [rows] = await db.pool.query(
            'SELECT title_id, current_progress FROM player_titles WHERE user_id = ?',
            [userId]
        );

        const unlockedTitles = {};
        rows.forEach(row => {
            unlockedTitles[row.title_id] = row.current_progress || 0;
        });

        // 返回称号列表
        const titles = TITLES_DATA.map(title => ({
            id: title.id,
            name: title.name,
            desc: title.desc,
            bonus: title.bonus,
            unlocked: unlockedTitles.hasOwnProperty(title.id),
            progress: unlockedTitles[title.id] || 0
        }));

        res.json({
            code: 200,
            data: { titles }
        });

    } catch (error) {
        console.error('获取称号列表失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 领取称号奖励
router.post('/claim/:titleId', authMiddleware, async (req, res) => {
    try {
        const { titleId } = req.params;
        const userId = req.user.userId;

        // 检查称号是否存在
        const title = TITLES_DATA.find(t => t.id === titleId);
        if (!title) {
            return res.status(404).json({ code: 404, message: '称号不存在' });
        }

        // 检查是否已解锁
        const [rows] = await db.pool.query(
            'SELECT * FROM player_titles WHERE user_id = ? AND title_id = ?',
            [userId, titleId]
        );

        if (rows.length === 0) {
            return res.status(400).json({ code: 400, message: '称号未解锁' });
        }

        // 检查是否已领取
        const [claimRows] = await db.pool.query(
            'SELECT * FROM title_rewards WHERE user_id = ? AND title_id = ?',
            [userId, titleId]
        );

        if (claimRows.length > 0) {
            return res.status(400).json({ code: 400, message: '奖励已领取' });
        }

        // 记录领取
        await db.pool.query(
            'INSERT INTO title_rewards (user_id, title_id) VALUES (?, ?)',
            [userId, titleId]
        );

        res.json({
            code: 200,
            message: '领取成功！'
        });

    } catch (error) {
        console.error('领取称号奖励失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 解锁称号（内部接口，由其他操作触发）
router.post('/unlock/:titleId', authMiddleware, async (req, res) => {
    try {
        const { titleId } = req.params;
        const userId = req.user.userId;

        // 检查称号是否存在
        const title = TITLES_DATA.find(t => t.id === titleId);
        if (!title) {
            return res.status(404).json({ code: 404, message: '称号不存在' });
        }

        // 检查是否已解锁
        const [rows] = await db.pool.query(
            'SELECT * FROM player_titles WHERE user_id = ? AND title_id = ?',
            [userId, titleId]
        );

        if (rows.length > 0) {
            return res.json({ code: 200, message: '称号已解锁' });
        }

        // 解锁称号
        await db.pool.query(
            'INSERT INTO player_titles (user_id, title_id, current_progress) VALUES (?, ?, 1)',
            [userId, titleId]
        );

        res.json({
            code: 200,
            message: '称号解锁成功！'
        });

    } catch (error) {
        console.error('解锁称号失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
