const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取十二财域列表
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM domains ORDER BY min_level ASC');
        res.json({ code: 200, data: { domains: rows } });
    } catch(e) { next(e); }
});

// 获取单个财域
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM domains WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.json({ code: 404, message: '财域不存在' });
        res.json({ code: 200, data: rows[0] });
    } catch(e) { next(e); }
});

// 创建财域（管理员）
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const { name, element, min_level, max_level, description, boss_name, boss_level, drop_items } = req.body;
        if (!name) return res.json({ code: 400, message: '名称不能为空' });
        const [result] = await pool.query(
            'INSERT INTO domains (name, element, min_level, max_level, description, boss_name, boss_level, drop_items) VALUES (?,?,?,?,?,?,?,?)',
            [name, element, min_level||1, max_level||10, description, boss_name, boss_level||1, drop_items]
        );
        res.json({ code: 200, message: '财域创建成功', data: { id: result.insertId } });
    } catch(e) { next(e); }
});

// 更新财域配置（管理员）
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const fields = req.body;
        const allowed = ['name','element','min_level','max_level','description','boss_name','boss_level','drop_items','is_open'];
        const keys = Object.keys(fields).filter(k => allowed.includes(k));
        if (!keys.length) return res.json({ code: 400, message: '无有效字段' });
        const sets = keys.map(k => k + '=?').join(',');
        const vals = keys.map(k => fields[k]);
        vals.push(req.params.id);
        await pool.query('UPDATE domains SET ' + sets + ' WHERE id=?', vals);
        res.json({ code: 200, message: '财域更新成功' });
    } catch(e) { next(e); }
});

module.exports = router;
