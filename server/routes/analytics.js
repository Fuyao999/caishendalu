const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取埋点事件统计
router.get('/summary', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const [events] = await pool.query(
            'SELECT event_name, event_category, COUNT(*) as count, MAX(created_at) as last_time FROM analytics_events GROUP BY event_name, event_category ORDER BY count DESC LIMIT 50'
        );
        const [total] = await pool.query('SELECT COUNT(*) as total FROM analytics_events');
        const [today] = await pool.query('SELECT COUNT(*) as today FROM analytics_events WHERE DATE(created_at) = CURDATE()');
        res.json({ code: 200, data: { events, total: total[0].total, today: today[0].today } });
    } catch(e) { next(e); }
});

// 查询埋点明细
router.get('/events', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const name = req.query.event_name;
        let sql = 'SELECT * FROM analytics_events';
        const params = [];
        if (name) { sql += ' WHERE event_name = ?'; params.push(name); }
        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        const [rows] = await pool.query(sql, params);
        res.json({ code: 200, data: { events: rows } });
    } catch(e) { next(e); }
});

// 上报埋点（客户端调用）
router.post('/track', async (req, res, next) => {
    try {
        const { event_name, event_category, event_data, user_id } = req.body;
        if (!event_name) return res.json({ code: 400, message: '事件名称不能为空' });
        const ip = req.ip || req.connection.remoteAddress;
        const device = req.headers['user-agent'] || '';
        await pool.query(
            'INSERT INTO analytics_events (event_name, event_category, user_id, event_data, ip_address, device_info) VALUES (?,?,?,?,?,?)',
            [event_name, event_category, user_id, JSON.stringify(event_data), ip, device.substring(0, 200)]
        );
        res.json({ code: 200, message: 'ok' });
    } catch(e) { next(e); }
});

module.exports = router;
