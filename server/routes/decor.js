const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 主题数据
const DECOR_THEMES = [
    { id: 'default', name: '默认', colors: ['#333333', '#222222'], bonus: {}, price: 0 },
    { id: 'red', name: '中国红', colors: ['#8B0000', '#FF0000'], bonus: { gold: 5 }, price: 100 },
    { id: 'gold', name: '金色年华', colors: ['#DAA520', '#FFD700'], bonus: { merit: 10 }, price: 200 },
    { id: 'jade', name: '翡翠绿', colors: ['#2E8B57', '#98FB98'], bonus: { fragments: 5 }, price: 150 }
];

// 装饰物品数据
const DECOR_ITEMS = [
    { id: ' statue1', name: '小财神像', emoji: '🧧', slot: '地面', bonus: { gold: 2 }, price: 50 },
    { id: 'banner1', name: '招财横幅', emoji: '🏮', slot: '墙面', bonus: { alms: 3 }, price: 80 },
    { id: 'plant1', name: '发财树', emoji: '🌲', slot: '角落', bonus: { merit: 5 }, price: 100 }
];

// 获取装修数据
router.get('/data', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        // 获取玩家装饰数据
        const [rows] = await db.pool.query(
            'SELECT decor_data FROM player_decor WHERE user_id = ?',
            [userId]
        );

        let decorData = {
            theme: 'default',
            ownedThemes: ['default'],
            ownedItems: [],
            equippedItems: []
        };

        if (rows.length > 0 && rows[0].decor_data) {
            try {
                decorData = JSON.parse(rows[0].decor_data);
            } catch (e) {
                decorData = { theme: 'default', ownedThemes: ['default'], ownedItems: [], equippedItems: [] };
            }
        }

        res.json({
            code: 200,
            data: decorData
        });

    } catch (error) {
        console.error('获取装修数据失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 保存装修数据
router.post('/save', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { theme, ownedThemes, ownedItems, equippedItems } = req.body;

        const decorData = {
            theme: theme || 'default',
            ownedThemes: ownedThemes || ['default'],
            ownedItems: ownedItems || [],
            equippedItems: equippedItems || []
        };

        // upsert
        const [existing] = await db.pool.query(
            'SELECT id FROM player_decor WHERE user_id = ?',
            [userId]
        );

        if (existing.length > 0) {
            await db.pool.query(
                'UPDATE player_decor SET decor_data = ? WHERE user_id = ?',
                [JSON.stringify(decorData), userId]
            );
        } else {
            await db.pool.query(
                'INSERT INTO player_decor (user_id, decor_data) VALUES (?, ?)',
                [userId, JSON.stringify(decorData)]
            );
        }

        res.json({
            code: 200,
            message: '保存成功！'
        });

    } catch (error) {
        console.error('保存装修数据失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

// 购买主题
router.post('/buy-theme/:themeId', authMiddleware, async (req, res) => {
    try {
        const { themeId } = req.params;
        const userId = req.user.userId;

        const theme = DECOR_THEMES.find(t => t.id === themeId);
        if (!theme) {
            return res.status(404).json({ code: 404, message: '主题不存在' });
        }

        if (theme.price === 0) {
            return res.status(400).json({ code: 400, message: '默认主题无需购买' });
        }

        // 获取玩家数据检查元宝
        const [playerRows] = await db.pool.query(
            'SELECT yuanbao FROM player_data WHERE user_id = ?',
            [userId]
        );

        if (playerRows.length === 0) {
            return res.status(404).json({ code: 404, message: '玩家不存在' });
        }

        const yuanbao = playerRows[0].yuanbao || 0;
        if (yuanbao < theme.price) {
            return res.status(400).json({ code: 400, message: '元宝不足' });
        }

        // 扣除元宝
        await db.pool.query(
            'UPDATE player_data SET yuanbao = yuanbao - ? WHERE user_id = ?',
            [theme.price, userId]
        );

        // 获取并更新装饰数据
        let decorData = { theme: 'default', ownedThemes: ['default'], ownedItems: [], equippedItems: [] };
        const [rows] = await db.pool.query(
            'SELECT decor_data FROM player_decor WHERE user_id = ?',
            [userId]
        );

        if (rows.length > 0 && rows[0].decor_data) {
            try {
                decorData = JSON.parse(rows[0].decor_data);
            } catch (e) {}
        }

        // 添加主题
        if (!decorData.ownedThemes.includes(themeId)) {
            decorData.ownedThemes.push(themeId);
        }
        decorData.theme = themeId;

        // 保存
        await db.pool.query(
            'INSERT INTO player_decor (user_id, decor_data) VALUES (?, ?) ON DUPLICATE KEY UPDATE decor_data = ?',
            [userId, JSON.stringify(decorData), JSON.stringify(decorData)]
        );

        res.json({
            code: 200,
            message: '购买成功！'
        });

    } catch (error) {
        console.error('购买主题失败:', error);
        res.status(500).json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
