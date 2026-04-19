// ============================================
// 财神大陆 - MySQL 连接池
// ============================================
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '77889900',
  database: process.env.DB_NAME || 'caishen_db',
  charset:  'utf8mb4',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // 自动重连
  maxIdle: 10,
  idleTimeout: 60000,
});

// 确保连接使用正确的字符集
pool.on('connection', (connection) => {
  connection.query('SET NAMES utf8mb4', (err) => {
    if (err) console.error('Set names error:', err);
  });
});

// 测试连接
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL 连接成功 -', process.env.DB_NAME);
    conn.release();
    return true;
  } catch (err) {
    console.error('❌ MySQL 连接失败:', err.message);
    return false;
  }
}

module.exports = { pool, testConnection };
