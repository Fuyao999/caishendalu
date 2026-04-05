const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取财神角色列表
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM deities WHERE is_active = 1 ORDER BY unlock_level ASC');
        res.json({ code: 200, data: { deities: rows } });
    } catch(e) { next(e); }
});

// 获取单个财神
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM deities WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.json({ code: 404, message: '财神不存在' });
        res.json({ code: 200, data: rows[0] });
    } catch(e) { next(e); }
});

// 创建财神（管理员）
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const { name, title, element, rarity, base_fortune, base_charm, skill_name, skill_desc, unlock_level, description } = req.body;
        if (!name) return res.json({ code: 400, message: '名称不能为空' });
        const [result] = await pool.query(
            'INSERT INTO deities (name, title, element, rarity, base_fortune, base_charm, skill_name, skill_desc, unlock_level, description) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [name, title, element||'gold', rarity||'normal', base_fortune||10, base_charm||10, skill_name, skill_desc, unlock_level||1, description]
        );
        res.json({ code: 200, message: '财神创建成功', data: { id: result.insertId } });
    } catch(e) { next(e); }
});

// 更新财神
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const fields = req.body;
        const keys = Object.keys(fields).filter(k => ['name','title','element','rarity','base_fortune','base_charm','skill_name','skill_desc','unlock_level','description','is_active'].includes(k));
        if (!keys.length) return res.json({ code: 400, message: '无有效字段' });
        const sets = keys.map(k => k + '=?').join(',');
        const vals = keys.map(k => fields[k]);
        vals.push(req.params.id);
        await pool.query('UPDATE deities SET ' + sets + ' WHERE id=?', vals);
        res.json({ code: 200, message: '财神更新成功' });
    } catch(e) { next(e); }
});

module.exports = router;
