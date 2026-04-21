// ============================================
// 财神大陆 - Express 主入口
// ============================================
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const { testConnection } = require('./config/database');
const { errorHandler }   = require('./middleware/errorHandler');

// 路由
const authRoutes      = require('./routes/auth');
const playerRoutes    = require('./routes/player');
const inventoryRoutes = require('./routes/inventory');
const equipmentRoutes = require('./routes/equipment');
const sideRoomRoutes  = require('./routes/sideRoom');
const almsRoutes      = require('./routes/alms');
const shopRoutes      = require('./routes/shop');
const skillRoutes     = require('./routes/skills');
const sectRoutes      = require('./routes/sects');
const mentorRoutes    = require('./routes/mentor');
const petRoutes       = require('./routes/pets');
const mountRoutes     = require('./routes/mounts');
const spiritRoutes    = require('./routes/spirits');
const marketRoutes    = require('./routes/market');
const pvpRoutes       = require('./routes/pvp');
const rechargeRoutes  = require('./routes/recharge');
const eventRoutes     = require('./routes/events');
const adminAuthRoutes = require('./routes/adminAuth');
const adminRolesRoutes = require('./routes/adminRoles');
const adminActivityRoutes = require('./routes/adminActivity');
const adminRoutes     = require('./routes/admin');
const announcementRoutes = require('./routes/announcements');
const deityRoutes     = require('./routes/deities');
const storyRoutes     = require('./routes/stories');
const domainRoutes    = require('./routes/domains');
const questRoutes     = require('./routes/quests');
const decorationRoutes = require('./routes/decoration');
const analyticsRoutes = require('./routes/analytics');
const settingsRoutes  = require('./routes/settings');
const robotRoutes     = require('./routes/robots');
const inviteRoutes    = require('./routes/invite');
const friendRoutes     = require('./routes/friend');
const mailRoutes       = require('./routes/mail');
const titleRoutes      = require('./routes/title');
const decorRoutes      = require('./routes/decor');
const cloudTourRoutes   = require('./routes/cloudTour');
const activityRoutes   = require('./routes/activity');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 中间件 ====================
app.use(helmet({
  contentSecurityPolicy: false,  // V19和管理后台都是内联JS，需要关闭CSP
  crossOriginEmbedderPolicy: false
}));
const corsOptions = {
  origin: function(origin, callback) {
    // 允许的 origins
    const allowedOrigins = [
      'http://localhost:8080',
      'http://localhost:7456',
      'http://localhost:3000',
      'http://127.0.0.1:7456',
      'http://127.0.0.1:3000'
    ];
    // 如果没有 origin（postman等）或在允许列表里，就通过
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};
app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 速率限制（开发期间关闭，上线前恢复！）
// app.use('/api/', rateLimit({
//   windowMs: 60 * 1000,
//   max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
//   message: { code: 429, message: '请求过于频繁，请稍后再试' }
// }));

// ==================== 路由挂载 ====================
app.use('/api/auth',      authRoutes);
app.use('/api/player',    playerRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/sideroom',  sideRoomRoutes);
app.use('/api/alms',      almsRoutes);
app.use('/api/shop',      shopRoutes);
app.use('/api/skills',    skillRoutes);
app.use('/api/sects',     sectRoutes);
app.use('/api/mentor',    mentorRoutes);
app.use('/api/pets',      petRoutes);
app.use('/api/mounts',    mountRoutes);
app.use('/api/spirits',   spiritRoutes);
app.use('/api/market',    marketRoutes);
app.use('/api/pvp',       pvpRoutes);
app.use('/api/recharge',  rechargeRoutes);
app.use('/api/events',    eventRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/roles', adminRolesRoutes);
app.use('/api/admin/activity', adminActivityRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/deities',   deityRoutes);
app.use('/api/stories',   storyRoutes);
app.use('/api/domains',   domainRoutes);
app.use('/api/quests',    questRoutes);
app.use('/api/decoration', decorationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/robots',     robotRoutes);
app.use('/api/invite',    inviteRoutes);
app.use('/api/friend',     friendRoutes);
app.use('/api/mail',       mailRoutes);
app.use('/api/title',      titleRoutes);
app.use('/api/decor',      decorRoutes);
app.use('/api/cloud-tour', cloudTourRoutes);
app.use('/api/activity', activityRoutes);

// ==================== 健康检查 ====================
app.get('/api/health', (req, res) => {
  res.json({
    code: 200,
    message: '财神大陆服务运行中 🏮',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ==================== 静态文件 (可选) ====================
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// ==================== 根路径 + 静态文件 ====================
app.use(express.static(path.join(__dirname, '..'), { etag: false, maxAge: 0, lastModified: false }));  // serve AdminPanelPhase2.html等

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>财神大陆 API</title>
  <style>body{background:#1a1a2e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{text-align:center;max-width:500px}.emoji{font-size:80px;margin-bottom:16px}h1{color:#f5a623;margin-bottom:8px}
  a{color:#64c8ff;text-decoration:none;display:inline-block;margin:8px 12px;padding:10px 20px;background:rgba(100,200,255,0.1);border:1px solid rgba(100,200,255,0.3);border-radius:8px}
  a:hover{background:rgba(100,200,255,0.2)}.api-list{text-align:left;background:rgba(255,255,255,0.05);padding:16px;border-radius:8px;margin-top:16px;font-size:13px;color:#aaa;line-height:1.8}</style></head>
  <body><div class="box">
  <div class="emoji">🏮</div><h1>财神大陆 API Server</h1><p style="color:#888">v1.0.0 · 运行中</p>
  <div style="margin-top:20px">
    <a href="/AdminPanelPhase2.html">🎛️ 管理后台</a>
    <a href="/api/health">💚 健康检查</a>
  </div>
  <div class="api-list"><b style="color:#f5a623">API 接口一览:</b><br>
  POST /api/auth/register · /api/auth/login<br>
  GET /api/player/info · POST /api/player/sign-in<br>
  GET /api/inventory · /api/shop · /api/equipment<br>
  POST /api/alms/go · GET /api/alms/status<br>
  GET /api/sects · /api/pets · /api/mounts · /api/skills<br>
  GET /api/market · /api/pvp/rank · /api/events<br>
  GET /api/admin/dashboard · /api/admin/users</div>
  </div></body></html>`);
});

// ==================== 版本检测 ====================
var APP_VERSION = Date.now().toString();
app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// ==================== 错误处理 ====================
app.use((req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在' });
});
app.use(errorHandler);

// ==================== 启动 ====================
async function start() {
  const dbOk = await testConnection();
  if (!dbOk) {
    console.error('⚠️ 数据库连接失败，但服务仍启动（部分功能不可用）');
  }
  
  app.listen(PORT, () => {
    console.log(`\n🏮 财神大陆服务启动成功`);
    console.log(`📡 地址: http://localhost:${PORT}`);
    console.log(`📋 健康检查: http://localhost:${PORT}/api/health`);
    console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}\n`);
    
    // 启动机器人香火钱自动产出定时任务（每分钟更新一次）
    const { pool } = require('./config/database');
    const STORAGE_LIMITS = {1:5000, 2:10000, 3:18000, 4:30000, 5:50000, 6:100000};
    // 每分钟产出（TEMPLE_DATA每天产出/1440分钟）
    const OUTPUT_PER_SEC = {1:0.028, 2:0.050, 3:0.069, 4:0.093, 5:0.116, 6:0.217};
    
    function updateRobotStorage() {
      pool.query('SELECT player_id, level, temple_storage, updated_at FROM robots').then(([rows]) => {
        rows.forEach(r => {
          const now = Date.now();
          const updatedAt = r.updated_at ? new Date(r.updated_at).getTime() : now;
          const elapsedMs = now - updatedAt;
          const elapsedHours = elapsedMs / (1000 * 60 * 60);
          const hourlyOutput = (OUTPUT_PER_MIN[r.level] || 1) * 60;
          const storageLimit = STORAGE_LIMITS[r.level] || 5000;
          const newStorage = Math.min((r.temple_storage || 0) + Math.floor(hourlyOutput * elapsedHours), storageLimit);
          if (newStorage !== r.temple_storage) {
            pool.query('UPDATE robots SET temple_storage = ?, updated_at = ? WHERE player_id = ?', [newStorage, new Date(), r.player_id]);
          }
        });
      }).catch(e => {});
    }
    
    // 更新真实玩家庙宇存储产出（需要香火在燃烧状态）
    function updatePlayerTempleStorage() {
      const now = Date.now();
      pool.query(
        `SELECT user_id, level, temple_storage, incense_type, incense_end_at 
         FROM player_data WHERE incense_type IS NOT NULL AND incense_end_at > ?`,
        [now]
      ).then(([rows]) => {
        rows.forEach(p => {
          const outputPerSec = OUTPUT_PER_SEC[p.level] || 0.028;
          const storageLimit = STORAGE_LIMITS[p.level] || 5000;
          const currentStorage = parseFloat(p.temple_storage) || 0;
          const newStorage = Math.min(currentStorage + outputPerSec, storageLimit);
          if (newStorage !== p.temple_storage) {
            pool.query('UPDATE player_data SET temple_storage = ? WHERE user_id = ?', [newStorage, p.user_id]);
          }
        });
      }).catch(e => { console.error('更新玩家庙宇产出失败:', e); });
    }
    
    // 每秒执行一次（产出按秒计算）
    updateRobotStorage();
    updatePlayerTempleStorage();
    setInterval(updateRobotStorage, 60000);
    setInterval(updatePlayerTempleStorage, 1000);
    console.log('🤖 机器人香火钱自动产出任务已启动（每分钟更新）');
    console.log('🏛️ 玩家庙宇存储产出任务已启动（每分钟更新）');
  });
}

start();

module.exports = app;
