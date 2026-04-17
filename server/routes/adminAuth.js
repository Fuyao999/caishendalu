const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'caishen_super_secret';

function generateToken(userId, username) {
    const payload = { userId, username };
    const token = require('jsonwebtoken').sign(payload, JWT_SECRET, { expiresIn: '30d' });
    return token;
}

// POST /api/admin/login - 管理后台登录
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.json({ code: 400, message: '请输入用户名和密码' });
    }
    
    try {
        const [rows] = await pool.query(
            'SELECT * FROM admin_users WHERE username = ?',
            [username]
        );
        
        if (rows.length === 0) {
            return res.json({ code: 401, message: '用户名或密码错误' });
        }
        
        const valid = await bcrypt.compare(password, rows[0].password_hash);
        if (!valid) {
            return res.json({ code: 401, message: '用户名或密码错误' });
        }
        
        const token = generateToken(rows[0].id, rows[0].username);
        
        return res.json({
            code: 200,
            data: {
                token,
                userId: rows[0].id,
                username: rows[0].username
            }
        });
    } catch(e) {
        console.error('Admin login error:', e);
        return res.json({ code: 500, message: '服务器错误' });
    }
});

// POST /api/admin/auth/change-password - 修改密码
router.post('/change-password', async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const auth = req.headers.authorization;
    
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ code: 401, message: '未登录' });
    }
    
    const token = auth.slice(7);
    try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.userId;
        
        if (!oldPassword || !newPassword) {
            return res.json({ code: 400, message: '旧密码和新密码都不能为空' });
        }
        
        const [rows] = await pool.query('SELECT * FROM admin_users WHERE id = ?', [userId]);
        if (rows.length === 0) {
            return res.json({ code: 404, message: '用户不存在' });
        }
        
        const valid = await bcrypt.compare(oldPassword, rows[0].password_hash);
        if (!valid) {
            return res.json({ code: 400, message: '旧密码错误' });
        }
        
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, userId]);
        
        return res.json({ code: 200, message: '密码修改成功' });
    } catch(e) {
        console.error('Change password error:', e);
        return res.json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
