const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取公告列表
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM announcements ORDER BY priority DESC, created_at DESC LIMIT 50'
        );
        res.json({ code: 200, data: { announcements: rows } });
    } catch(e) { next(e); }
});

// 获取单个公告
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.json({ code: 404, message: '公告不存在' });
        res.json({ code: 200, data: rows[0] });
    } catch(e) { next(e); }
});

// 创建公告（管理员）
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const { title, content, type, priority, start_time, end_time } = req.body;
        if (!title) return res.json({ code: 400, message: '标题不能为空' });
        const [result] = await pool.query(
            'INSERT INTO announcements (title, content, type, priority, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
            [title, content, type || 'system', priority || 0, start_time, end_time]
        );
        res.json({ code: 200, message: '公告创建成功', data: { id: result.insertId } });
    } catch(e) { next(e); }
});

// 更新公告
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const { title, content, type, priority, is_active, start_time, end_time } = req.body;
        await pool.query(
            'UPDATE announcements SET title=COALESCE(?,title), content=COALESCE(?,content), type=COALESCE(?,type), priority=COALESCE(?,priority), is_active=COALESCE(?,is_active), start_time=COALESCE(?,start_time), end_time=COALESCE(?,end_time) WHERE id=?',
            [title, content, type, priority, is_active, start_time, end_time, req.params.id]
        );
        res.json({ code: 200, message: '公告更新成功' });
    } catch(e) { next(e); }
});

// 删除公告
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        await pool.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
        res.json({ code: 200, message: '公告已删除' });
    } catch(e) { next(e); }
});

module.exports = router;
