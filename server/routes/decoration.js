const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取装修物品列表
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const category = req.query.category;
        let sql = 'SELECT * FROM decorations WHERE is_active = 1';
        const params = [];
        if (category) { sql += ' AND category = ?'; params.push(category); }
        sql += ' ORDER BY category, price_gold ASC';
        const [rows] = await pool.query(sql, params);
        res.json({ code: 200, data: { decorations: rows, total: rows.length } });
    } catch(e) { next(e); }
});

// 创建装修物品（管理员）
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const { name, category, rarity, price_gold, price_yuanbao, bonus_type, bonus_value, description, is_limited } = req.body;
        if (!name) return res.json({ code: 400, message: '名称不能为空' });
        const [result] = await pool.query(
            'INSERT INTO decorations (name, category, rarity, price_gold, price_yuanbao, bonus_type, bonus_value, description, is_limited) VALUES (?,?,?,?,?,?,?,?,?)',
            [name, category||'exterior', rarity||'normal', price_gold||0, price_yuanbao||0, bonus_type, bonus_value||0, description, is_limited||0]
        );
        res.json({ code: 200, message: '装修物品创建成功', data: { id: result.insertId } });
    } catch(e) { next(e); }
});

// 更新装修物品
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const fields = req.body;
        const allowed = ['name','category','rarity','price_gold','price_yuanbao','bonus_type','bonus_value','description','is_limited','is_active'];
        const keys = Object.keys(fields).filter(k => allowed.includes(k));
        if (!keys.length) return res.json({ code: 400, message: '无有效字段' });
        const sets = keys.map(k => k + '=?').join(',');
        const vals = keys.map(k => fields[k]);
        vals.push(req.params.id);
        await pool.query('UPDATE decorations SET ' + sets + ' WHERE id=?', vals);
        res.json({ code: 200, message: '装修物品更新成功' });
    } catch(e) { next(e); }
});

module.exports = router;
