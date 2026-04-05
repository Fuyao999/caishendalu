const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取所有系统设置
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const [rows] = await pool.query('SELECT * FROM system_settings ORDER BY id ASC');
        res.json({ code: 200, data: { settings: rows } });
    } catch(e) { next(e); }
});

// 获取单个设置
router.get('/:key', authMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM system_settings WHERE setting_key = ?', [req.params.key]);
        if (!rows.length) return res.json({ code: 404, message: '设置不存在' });
        res.json({ code: 200, data: rows[0] });
    } catch(e) { next(e); }
});

// 更新设置（管理员）
router.put('/:key', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const { value } = req.body;
        const [result] = await pool.query(
            'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
            [value, req.params.key]
        );
        if (result.affectedRows === 0) return res.json({ code: 404, message: '设置不存在' });
        res.json({ code: 200, message: '设置更新成功' });
    } catch(e) { next(e); }
});

// 批量更新设置
router.post('/batch', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const settings = req.body.settings;
        if (!settings || typeof settings !== 'object') return res.json({ code: 400, message: '参数错误' });
        for (const [key, value] of Object.entries(settings)) {
            await pool.query('UPDATE system_settings SET setting_value = ? WHERE setting_key = ?', [String(value), key]);
        }
        res.json({ code: 200, message: '批量更新成功' });
    } catch(e) { next(e); }
});

module.exports = router;
