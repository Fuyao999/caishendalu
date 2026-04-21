// ============================================
// 认证路由 - 注册/登录
// ============================================
const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const { pool } = require('../config/database');
const { generateToken } = require('../middleware/auth');
const { success, fail, getRealm } = require('../utils/helpers');

// POST /api/auth/register - 注册
router.post('/register', async (req, res, next) => {
  try {
    const { username, password, nickname } = req.body;
    
    if (!username || !password) {
      return fail(res, '用户名和密码不能为空');
    }
    if (username.length < 3 || username.length > 32) {
      return fail(res, '用户名长度3-32个字符');
    }
    if (password.length < 6) {
      return fail(res, '密码至少6个字符');
    }
    
    // 检查用户名是否已存在
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE username = ?', [username]
    );
    if (existing.length > 0) {
      return fail(res, '用户名已存在');
    }
    
    // 生成唯一的7位随机玩家ID（防碰撞，最多重试10次）
    let playerId;
    let attempts = 0;
    do {
      playerId = Math.floor(1000000 + Math.random() * 9000000); // 1000000-9999999
      const [dup] = await pool.query(
        'SELECT id FROM users WHERE player_id = ?', [playerId]
      );
      if (dup.length === 0) break;
      attempts++;
    } while (attempts < 10);
    if (attempts >= 10) {
      return fail(res, '注册失败，请重试');
    }
    
    // 创建用户
    const passwordHash = await bcrypt.hash(password, 10);
    const [userResult] = await pool.query(
      'INSERT INTO users (player_id, username, password_hash) VALUES (?, ?, ?)',
      [playerId, username, passwordHash]
    );
    const userId = userResult.insertId;
    
    // 创建玩家数据
    const playerNick = nickname || '无名散修';
    const invitationCode = 'CS' + Math.random().toString(36).substring(2, 8).toUpperCase();
    await pool.query(
      'INSERT INTO player_data (user_id, player_id, nickname, gold, invitation_code) VALUES (?, ?, ?, 2400, ?)',
      [userId, playerId, playerNick, invitationCode]
    );
    
    // 创建VIP记录
    await pool.query(
      'INSERT INTO player_vip (user_id) VALUES (?)', [userId]
    );
    
    // 创建排名记录
    await pool.query(
      'INSERT INTO player_rank (user_id) VALUES (?)', [userId]
    );
    
    // 生成Token
    const token = generateToken(userId, username);
    
    // 记日志
    await pool.query(
      'INSERT INTO logs (user_id, action, detail, ip) VALUES (?, ?, ?, ?)',
      [userId, 'register', JSON.stringify({ username }), req.ip]
    );
    
    return success(res, {
      token,
      userId: playerId,
      username,
      nickname: playerNick,
    }, '注册成功，欢迎来到财神大陆！');
    
  } catch (err) { next(err); }
});

// POST /api/auth/login - 登录
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return fail(res, '用户名和密码不能为空');
    }
    
    // 查找用户
    const [users] = await pool.query(
      'SELECT id, username, password_hash, status, ban_reason FROM users WHERE username = ?',
      [username]
    );
    
    if (users.length === 0) {
      return fail(res, '用户名或密码错误');
    }
    
    const user = users[0];
    
    // 检查封禁
    if (user.status === 0) {
      return fail(res, '账号已被封禁：' + (user.ban_reason || '违规操作'));
    }
    
    // 验证密码
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return fail(res, '用户名或密码错误');
    }
    
    // 更新登录信息
    await pool.query(
      'UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?',
      [req.ip, user.id]
    );
    
    // 获取玩家数据
    const [playerRows] = await pool.query(
      'SELECT player_id, nickname, level, realm_name, gold, yuanbao FROM player_data WHERE user_id = ?',
      [user.id]
    );
    
    const token = generateToken(user.id, user.username, playerRows[0]?.player_id);
        console.log('=== LOGIN DEBUG ===');
        console.log('user.id:', user.id);
        console.log('playerRows:', playerRows);
        console.log('player_id to embed:', playerRows[0]?.player_id);
    
    // 记日志
    await pool.query(
      'INSERT INTO logs (user_id, action, ip) VALUES (?, ?, ?)',
      [user.id, 'login', req.ip]
    );
    
    return success(res, {
      token,
      userId: user.id,
      playerId: playerRows[0] ? playerRows[0].player_id : null,
      username: user.username,
      player: playerRows[0] || null,
    }, '登录成功');
    
  } catch (err) { next(err); }
});

// POST /api/auth/change-password - 修改密码
router.post('/change-password', async (req, res, next) => {
  try {
    const { authMiddleware } = require('../middleware/auth');
    // 内联认证（也可用路由级中间件）
    const authHeader = req.headers.authorization;
    if (!authHeader) return fail(res, '未登录', 401);
    
    const { userId } = require('jsonwebtoken').verify(
      authHeader.substring(7),
      process.env.JWT_SECRET
    );
    
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return fail(res, '请填写旧密码和新密码');
    }
    if (newPassword.length < 6) {
      return fail(res, '新密码至少6个字符');
    }
    
    const [users] = await pool.query(
      'SELECT password_hash FROM users WHERE id = ?', [userId]
    );
    if (users.length === 0) return fail(res, '用户不存在');
    
    const valid = await bcrypt.compare(oldPassword, users[0].password_hash);
    if (!valid) return fail(res, '旧密码错误');
    
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
    
    return success(res, null, '密码修改成功');
  } catch (err) { next(err); }
});

module.exports = router;
