// ============================================
// 财神大陆 - 统一错误处理
// ============================================

// API 错误响应格式
class ApiError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

// 错误处理中间件
function errorHandler(err, req, res, next) {
  console.error('API Error:', err);
  
  // MySQL 错误
  if (err.code && err.code.startsWith('ER_')) {
    return res.status(500).json({
      code: 500,
      message: '数据库错误',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
  
  // 自定义API错误
  if (err instanceof ApiError) {
    return res.status(400).json({
      code: err.code,
      message: err.message,
      data: err.data
    });
  }
  
  // JWT 错误
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      code: 401,
      message: '认证失败：' + err.message
    });
  }
  
  // 默认错误
  return res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
}

module.exports = { ApiError, errorHandler };
