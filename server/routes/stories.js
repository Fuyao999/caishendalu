const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 获取故事列表
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const region = req.query.region;
        let sql = 'SELECT id, region, region_name, title, tags, is_active, created_at FROM stories';
        const params = [];
        if (region) { sql += ' WHERE region = ?'; params.push(region); }
        sql += ' ORDER BY region, id LIMIT 200';
        const [rows] = await pool.query(sql, params);
        res.json({ code: 200, data: { stories: rows, total: rows.length } });
    } catch(e) { next(e); }
});

// 获取单个故事详情
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM stories WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.json({ code: 404, message: '故事不存在' });
        res.json({ code: 200, data: rows[0] });
    } catch(e) { next(e); }
});

// 创建故事（管理员）
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const { region, region_name, title, intro, result_jp, result_bw, result_nm, result_sw, result_ms, tags } = req.body;
        if (!region || !intro) return res.json({ code: 400, message: '区域和故事内容不能为空' });
        const [result] = await pool.query(
            'INSERT INTO stories (region, region_name, title, intro, result_jp, result_bw, result_nm, result_sw, result_ms, tags) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [region, region_name, title, intro, result_jp, result_bw, result_nm, result_sw, result_ms, tags]
        );
        res.json({ code: 200, message: '故事创建成功', data: { id: result.insertId } });
    } catch(e) { next(e); }
});

// 批量导入故事
router.post('/batch', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const stories = req.body.stories;
        if (!Array.isArray(stories) || !stories.length) return res.json({ code: 400, message: '故事数组不能为空' });
        let count = 0;
        for (const s of stories) {
            if (!s.region || !s.intro) continue;
            await pool.query(
                'INSERT INTO stories (region, region_name, title, intro, result_jp, result_bw, result_nm, result_sw, result_ms, tags) VALUES (?,?,?,?,?,?,?,?,?,?)',
                [s.region, s.region_name, s.title, s.intro, s.result_jp, s.result_bw, s.result_nm, s.result_sw, s.result_ms, s.tags]
            );
            count++;
        }
        res.json({ code: 200, message: '批量导入成功', data: { imported: count } });
    } catch(e) { next(e); }
});

// 更新故事
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        if (req.userId !== 1) return res.json({ code: 403, message: '无权限' });
        const fields = req.body;
        const allowed = ['region','region_name','title','intro','result_jp','result_bw','result_nm','result_sw','result_ms','tags','is_active'];
        const keys = Object.keys(fields).filter(k => allowed.includes(k));
        if (!keys.length) return res.json({ code: 400, message: '无有效字段' });
        const sets = keys.map(k => k + '=?').join(',');
        const vals = keys.map(k => fields[k]);
        vals.push(req.params.id);
        await pool.query('UPDATE stories SET ' + sets + ' WHERE id=?', vals);
        res.json({ code: 200, message: '故事更新成功' });
    } catch(e) { next(e); }
});

module.exports = router;
