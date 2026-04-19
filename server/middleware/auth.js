// ============================================
// 财神大陆 - JWT 认证中间件
// ============================================
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'caishen_super_secret';

// 验证Token
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      code: 401, 
      message: '未登录或Token无效' 
    });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.userId = decoded.userId;  // 兼容路由中直接用 req.userId
    next();
  } catch (err) {
    return res.status(401).json({ 
      code: 401, 
      message: 'Token已过期或无效',
      error: err.message 
    });
  }
}

// 可选认证（不强制要求登录，但有登录信息会解析）
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      // 忽略解析失败
    }
  }
  next();
}

// 生成Token
function generateToken(userId, username) {
  return jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// 验证管理员Token
function adminMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      code: 401, 
      message: '未登录或Token无效' 
    });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.userId = decoded.userId;
    
    // 验证是否是管理员
    const [admins] = pool.query('SELECT id FROM admin_users WHERE username = ?', [decoded.username]);
    if (admins.length === 0) {
      return res.status(403).json({ 
        code: 403, 
        message: '无权限访问' 
      });
    }
    
    next();
  } catch (err) {
    return res.status(401).json({ 
      code: 401, 
      message: 'Token已过期或无效'
    });
  }
}

module.exports = { authMiddleware, optionalAuth, generateToken, adminMiddleware };
