const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// 获取任务列表（后台管理）
router.get('/quests', adminMiddleware, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const type = req.query.type;
        const search = req.query.search;
        
        let sql = 'SELECT q.*, t.name as title_name FROM quests q LEFT JOIN titles t ON q.title_id = t.id WHERE 1=1';
        let countSql = 'SELECT COUNT(*) as total FROM quests WHERE 1=1';
        const params = [];
        
        if (type) {
            sql += ' AND q.type = ?';
            countSql += ' AND type = ?';
            params.push(type);
        }
        
        if (search) {
            sql += ' AND (q.id LIKE ? OR q.name LIKE ?)';
            countSql += ' AND (id LIKE ? OR name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        sql += ' ORDER BY q.type, q.sort_order LIMIT ? OFFSET ?';
        params.push(limit, offset);
        
        const [rows] = await pool.query(sql, params);
        const [countResult] = await pool.query(countSql, params.slice(0, type || search ? (type ? 1 : 2) : 0));
        const total = countResult[0].total;
        
        // 获取每个任务的完成人数
        const questIds = rows.map(r => r.id);
        let completionStats = {};
        if (questIds.length > 0) {
            const [stats] = await pool.query(
                'SELECT quest_id, COUNT(*) as count FROM player_quest_progress WHERE claimed = 1 AND quest_id IN (?) GROUP BY quest_id',
                [questIds]
            );
            stats.forEach(s => {
                completionStats[s.quest_id] = s.count;
            });
        }
        
        const result = rows.map(q => ({
            ...q,
            completion_count: completionStats[q.id] || 0
        }));
        
        res.json({
            code: 200,
            data: {
                quests: result,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch(e) {
        next(e);
    }
});

// 创建/更新任务
router.post('/quests', adminMiddleware, async (req, res, next) => {
    try {
        const {
            id, title_id, type, name, description, target_type, target_count,
            reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle,
            reward_gold_paper, reward_fruit, reward_yuanbao, unlock_level, sort_order
        } = req.body;
        
        if (!id || !name || !type || !target_type) {
            return res.json({ code: 400, message: '缺少必要字段' });
        }
        
        // 检查是否存在
        const [existing] = await pool.query('SELECT id FROM quests WHERE id = ?', [id]);
        
        if (existing.length) {
            // 更新
            await pool.query(`
                UPDATE quests SET 
                    title_id = ?, type = ?, name = ?, description = ?, target_type = ?,
                    target_count = ?, reward_gold = ?, reward_merit = ?, reward_fragment = ?,
                    reward_incense = ?, reward_candle = ?, reward_gold_paper = ?, reward_fruit = ?,
                    reward_yuanbao = ?, unlock_level = ?, sort_order = ?
                WHERE id = ?
            `, [title_id, type, name, description, target_type, target_count || 1,
                reward_gold || 0, reward_merit || 0, reward_fragment || 0,
                reward_incense || 0, reward_candle || 0, reward_gold_paper || 0, reward_fruit || 0,
                reward_yuanbao || 0, unlock_level || 1, sort_order || 0, id]);
            
            res.json({ code: 200, message: '任务更新成功' });
        } else {
            // 创建
            await pool.query(`
                INSERT INTO quests (id, title_id, type, name, description, target_type, target_count,
                    reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle,
                    reward_gold_paper, reward_fruit, reward_yuanbao, unlock_level, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, title_id, type, name, description, target_type, target_count || 1,
                reward_gold || 0, reward_merit || 0, reward_fragment || 0,
                reward_incense || 0, reward_candle || 0, reward_gold_paper || 0, reward_fruit || 0,
                reward_yuanbao || 0, unlock_level || 1, sort_order || 0]);
            
            res.json({ code: 200, message: '任务创建成功' });
        }
    } catch(e) {
        next(e);
    }
});

// 删除任务
router.delete('/quests/:id', adminMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE quests SET is_active = 0 WHERE id = ?', [id]);
        res.json({ code: 200, message: '任务已停用' });
    } catch(e) {
        next(e);
    }
});

// 获取称号列表（后台管理）
router.get('/titles', adminMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM titles ORDER BY sort_order');
        
        // 获取每个称号的解锁人数
        const [stats] = await pool.query(
            'SELECT title_id, COUNT(*) as count FROM player_titles WHERE unlocked = 1 GROUP BY title_id'
        );
        
        const statsMap = {};
        stats.forEach(s => {
            statsMap[s.title_id] = s.count;
        });
        
        const result = rows.map(t => ({
            ...t,
            unlock_count: statsMap[t.id] || 0
        }));
        
        res.json({ code: 200, data: result });
    } catch(e) {
        next(e);
    }
});

// 创建/更新称号
router.post('/titles', adminMiddleware, async (req, res, next) => {
    try {
        const { id, name, desc, bonus, icon, sort_order } = req.body;
        
        if (!id || !name || !desc || !bonus) {
            return res.json({ code: 400, message: '缺少必要字段' });
        }
        
        const [existing] = await pool.query('SELECT id FROM titles WHERE id = ?', [id]);
        
        if (existing.length) {
            await pool.query(
                'UPDATE titles SET name = ?, `desc` = ?, bonus = ?, icon = ?, sort_order = ? WHERE id = ?',
                [name, desc, bonus, icon || '🏆', sort_order || 0, id]
            );
            res.json({ code: 200, message: '称号更新成功' });
        } else {
            await pool.query(
                'INSERT INTO titles (id, name, `desc`, bonus, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
                [id, name, desc, bonus, icon || '🏆', sort_order || 0]
            );
            res.json({ code: 200, message: '称号创建成功' });
        }
    } catch(e) {
        next(e);
    }
});

// 删除称号
router.delete('/titles/:id', adminMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE titles SET is_active = 0 WHERE id = ?', [id]);
        res.json({ code: 200, message: '称号已停用' });
    } catch(e) {
        next(e);
    }
});

// 重置玩家任务进度
router.post('/quests/:playerId/reset', adminMiddleware, async (req, res, next) => {
    try {
        const { playerId } = req.params;
        const { quest_id } = req.body;
        
        if (quest_id) {
            await pool.query(
                'DELETE FROM player_quest_progress WHERE player_id = ? AND quest_id = ?',
                [playerId, quest_id]
            );
            res.json({ code: 200, message: '玩家任务进度已重置' });
        } else {
            await pool.query(
                'DELETE FROM player_quest_progress WHERE player_id = ?',
                [playerId]
            );
            res.json({ code: 200, message: '玩家所有任务进度已重置' });
        }
    } catch(e) {
        next(e);
    }
});

module.exports = router;
