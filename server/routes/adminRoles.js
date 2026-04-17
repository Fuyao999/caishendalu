const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// 获取所有角色
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM admin_roles ORDER BY id');
        return res.json({ code: 200, data: rows });
    } catch(e) {
        return res.json({ code: 500, message: '服务器错误' });
    }
});

// 创建角色
router.post('/', async (req, res) => {
    const { name, permissions } = req.body;
    if (!name) return res.json({ code: 400, message: '角色名不能为空' });
    try {
        const [result] = await pool.query(
            'INSERT INTO admin_roles (name, permissions) VALUES (?, ?)',
            [name, permissions || '']
        );
        return res.json({ code: 200, data: { id: result.insertId }, message: '创建成功' });
    } catch(e) {
        return res.json({ code: 500, message: '服务器错误' });
    }
});

// 删除角色
router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (id === 1) return res.json({ code: 400, message: '不能删除超级管理员' });
    try {
        await pool.query('DELETE FROM admin_user_roles WHERE role_id = ?', [id]);
        await pool.query('DELETE FROM admin_roles WHERE id = ?', [id]);
        return res.json({ code: 200, message: '删除成功' });
    } catch(e) {
        return res.json({ code: 500, message: '服务器错误' });
    }
});

// 获取所有管理员
router.get('/users', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT u.id, u.username, u.created_at, GROUP_CONCAT(r.name) as roles
            FROM admin_users u
            LEFT JOIN admin_user_roles ur ON u.id = ur.user_id
            LEFT JOIN admin_roles r ON ur.role_id = r.id
            GROUP BY u.id
        `);
        return res.json({ code: 200, data: rows });
    } catch(e) {
        return res.json({ code: 500, message: '服务器错误' });
    }
});

// 添加管理员
router.post('/users', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ code: 400, message: '用户名和密码不能为空' });
    try {
        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)',
            [username, hash]
        );
        // 默认给运营角色
        await pool.query(
            'INSERT INTO admin_user_roles (user_id, role_id) VALUES (?, 2)',
            [result.insertId]
        );
        return res.json({ code: 200, data: { id: result.insertId }, message: '创建成功' });
    } catch(e) {
        if (e.code === 'ER_DUP_ENTRY') {
            return res.json({ code: 400, message: '用户名已存在' });
        }
        return res.json({ code: 500, message: '服务器错误' });
    }
});

// 删除管理员
router.delete('/users/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (id === 1) return res.json({ code: 400, message: '不能删除超级管理员' });
    try {
        await pool.query('DELETE FROM admin_user_roles WHERE user_id = ?', [id]);
        await pool.query('DELETE FROM admin_users WHERE id = ?', [id]);
        return res.json({ code: 200, message: '删除成功' });
    } catch(e) {
        return res.json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
