const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取任务/成就列表
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const type = req.query.type;
        let sql = 'SELECT * FROM quests WHERE is_active = 1';
        const params = [];
        if (type) { sql += ' AND type = ?'; params.push(type); }
        sql += ' ORDER BY type, unlock_level ASC LIMIT 200';
        const [rows] = await pool.query(sql, params);
        res.json({ code: 200, data: { quests: rows, total: rows.length } });
    } catch(e) { next(e); }
});

// 创建任务（管理员）
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const { name, type, description, target_type, target_count, reward_gold, reward_exp, reward_items, unlock_level } = req.body;
        if (!name) return res.json({ code: 400, message: '任务名称不能为空' });
        const [result] = await pool.query(
            'INSERT INTO quests (name, type, description, target_type, target_count, reward_gold, reward_exp, reward_items, unlock_level) VALUES (?,?,?,?,?,?,?,?,?)',
            [name, type||'daily', description, target_type, target_count||1, reward_gold||0, reward_exp||0, reward_items, unlock_level||1]
        );
        res.json({ code: 200, message: '任务创建成功', data: { id: result.insertId } });
    } catch(e) { next(e); }
});

// 更新任务
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const fields = req.body;
        const allowed = ['name','type','description','target_type','target_count','reward_gold','reward_exp','reward_items','unlock_level','is_active'];
        const keys = Object.keys(fields).filter(k => allowed.includes(k));
        if (!keys.length) return res.json({ code: 400, message: '无有效字段' });
        const sets = keys.map(k => k + '=?').join(',');
        const vals = keys.map(k => fields[k]);
        vals.push(req.params.id);
        await pool.query('UPDATE quests SET ' + sets + ' WHERE id=?', vals);
        res.json({ code: 200, message: '任务更新成功' });
    } catch(e) { next(e); }
});

// 删除任务
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        await pool.query('UPDATE quests SET is_active = 0 WHERE id = ?', [req.params.id]);
        res.json({ code: 200, message: '任务已停用' });
    } catch(e) { next(e); }
});

module.exports = router;
