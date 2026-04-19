// ============================================
// 管理后台路由 - 数据概览/用户管理/日志/配置
// 需要管理员权限（暂用token中userId=1判定）
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// 管理员检查中间件（使用Authorization header）
const adminCheck = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return fail(res, '无权限', 403);
  }
  const token = auth.slice(7);
  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'caishen_super_secret';
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.user = { id: decoded.userId, username: decoded.username };
    next();
  } catch(e) {
    return fail(res, '无效token', 403);
  }
};

// GET /api/admin/dashboard - 数据概览
router.get('/dashboard', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const [[userCount]] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
    const [[activeToday]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM users WHERE DATE(last_login_at) = CURDATE()'
    );
    const [[playerStats]] = await pool.query(
      'SELECT AVG(level) AS avg_level, MAX(level) AS max_level, SUM(gold) AS total_gold FROM player_data'
    );
    const [[orderStats]] = await pool.query(
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_cny),0) AS total_cny FROM recharge_orders WHERE status = 'paid'"
    );
    const [[todayOrders]] = await pool.query(
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_cny),0) AS total_cny FROM recharge_orders WHERE status = 'paid' AND DATE(paid_at) = CURDATE()"
    );
    const [[cheatCount]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM cheat_detection WHERE resolved = 0'
    );

    return success(res, {
      users: { total: userCount.cnt, activeToday: activeToday.cnt },
      players: {
        avgLevel: Math.round((playerStats.avg_level || 0) * 10) / 10,
        maxLevel: playerStats.max_level || 0,
        totalGold: playerStats.total_gold || 0
      },
      revenue: {
        totalOrders: orderStats.cnt,
        totalCNY: parseFloat(orderStats.total_cny),
        todayOrders: todayOrders.cnt,
        todayCNY: parseFloat(todayOrders.total_cny)
      },
      alerts: { unresolvedCheats: cheatCount.cnt }
    }, '数据概览');
  } catch (err) { next(err); }
});

// GET /api/admin/users - 用户列表
router.get('/users', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (search) {
      where += ' AND (u.username LIKE ? OR u.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status !== undefined) { where += ' AND u.status = ?'; params.push(parseInt(status)); }

    const [rows] = await pool.query(
      `SELECT u.id, u.player_id, u.username, u.email, u.phone, u.status, u.ban_reason,
              u.last_login_at, u.created_at,
              pd.nickname, pd.level, pd.realm_name, pd.gold, pd.yuanbao,
              pv.vip_level, pv.total_recharge
       FROM users u
       LEFT JOIN player_data pd ON u.id = pd.user_id
       LEFT JOIN player_vip pv ON u.id = pv.user_id
       WHERE ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [total] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM users u WHERE ${where}`, params
    );

    return success(res, { users: rows, total: total[0].cnt, page: parseInt(page) }, '用户列表');
  } catch (err) { next(err); }
});

// GET /api/admin/users/:id - 用户详情
router.get('/users/:id', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const uid = req.params.id;
    const [user] = await pool.query('SELECT * FROM users WHERE id = ?', [uid]);
    if (user.length === 0) return fail(res, '用户不存在');

    const [player] = await pool.query('SELECT * FROM player_data WHERE user_id = ?', [uid]);
    const [vip] = await pool.query('SELECT * FROM player_vip WHERE user_id = ?', [uid]);
    const [inventory] = await pool.query(
      `SELECT inv.*, i.name, i.rarity FROM inventory inv
       JOIN items i ON inv.item_id = i.id WHERE inv.user_id = ?`, [uid]
    );
    const [equipment] = await pool.query(
      `SELECT e.*, i.name, i.rarity FROM equipment e
       LEFT JOIN items i ON e.item_id = i.id WHERE e.user_id = ?`, [uid]
    );
    const [recentLogs] = await pool.query(
      'SELECT * FROM logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [uid]
    );

    // 删掉密码hash
    delete user[0].password_hash;

    return success(res, {
      user: user[0],
      player: player[0] || null,
      vip: vip[0] || null,
      inventory,
      equipment,
      recentLogs
    }, '用户详情');
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/ban - 封禁用户
router.post('/users/:id/ban', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const uid = req.params.id;
    const { reason } = req.body;
    if (uid == 1) return fail(res, '不能封禁超级管理员');

    await pool.query(
      'UPDATE users SET status = 0, ban_reason = ? WHERE id = ?',
      [reason || '管理员封禁', uid]
    );
    await pool.query(
      'INSERT INTO logs (user_id, action, detail) VALUES (?,?,?)',
      [req.userId, 'admin_ban', JSON.stringify({ targetId: uid, reason })]
    );
    return success(res, null, '用户已封禁');
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/unban - 解封用户
router.post('/users/:id/unban', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const uid = req.params.id;
    await pool.query('UPDATE users SET status = 1, ban_reason = NULL WHERE id = ?', [uid]);
    await pool.query(
      'INSERT INTO logs (user_id, action, detail) VALUES (?,?,?)',
      [req.userId, 'admin_unban', JSON.stringify({ targetId: uid })]
    );
    return success(res, null, '用户已解封');
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/give - 发放物资（金币/元宝/物品）
router.post('/users/:id/give', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const uid = req.params.id;
    const { gold, yuanbao, itemId, quantity, reason } = req.body;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (gold) {
        await conn.query('UPDATE player_data SET gold = gold + ? WHERE user_id = ?', [gold, uid]);
      }
      if (yuanbao) {
        await conn.query('UPDATE player_data SET yuanbao = yuanbao + ? WHERE user_id = ?', [yuanbao, uid]);
      }
      if (itemId) {
        const qty = quantity || 1;
        const [maxSlot] = await conn.query(
          'SELECT COALESCE(MAX(slot),0)+1 AS ns FROM inventory WHERE user_id = ?', [uid]
        );
        await conn.query(
          'INSERT INTO inventory (user_id, item_id, quantity, slot) VALUES (?,?,?,?)',
          [uid, itemId, qty, maxSlot[0].ns]
        );
      }

      await conn.query(
        'INSERT INTO logs (user_id, action, detail) VALUES (?,?,?)',
        [req.userId, 'admin_give', JSON.stringify({ targetId: uid, gold, yuanbao, itemId, quantity, reason })]
      );

      await conn.commit();
      return success(res, null, '发放成功');
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// GET /api/admin/logs - 系统日志查询
router.get('/logs', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { userId, action, startDate, endDate, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (userId) { where += ' AND l.user_id = ?'; params.push(parseInt(userId)); }
    if (action) { where += ' AND l.action = ?'; params.push(action); }
    if (startDate) { where += ' AND l.created_at >= ?'; params.push(startDate); }
    if (endDate) { where += ' AND l.created_at <= ?'; params.push(endDate + ' 23:59:59'); }

    const [rows] = await pool.query(
      `SELECT l.*, u.username FROM logs l
       LEFT JOIN users u ON l.user_id = u.id
       WHERE ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    return success(res, rows, '系统日志');
  } catch (err) { next(err); }
});

// GET /api/admin/cheats - 作弊检测记录
router.get('/cheats', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { resolved, severity, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (resolved !== undefined) { where += ' AND cd.resolved = ?'; params.push(parseInt(resolved)); }
    if (severity) { where += ' AND cd.severity = ?'; params.push(parseInt(severity)); }

    const [rows] = await pool.query(
      `SELECT cd.*, u.username FROM cheat_detection cd
       JOIN users u ON cd.user_id = u.id
       WHERE ${where} ORDER BY cd.severity DESC, cd.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    return success(res, rows, '作弊检测');
  } catch (err) { next(err); }
});

// POST /api/admin/cheats/:id/resolve - 处理作弊记录
router.post('/cheats/:id/resolve', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { action } = req.body; // warn/mute/ban/none
    const cheatId = req.params.id;

    const [cheat] = await pool.query('SELECT * FROM cheat_detection WHERE id = ?', [cheatId]);
    if (cheat.length === 0) return fail(res, '记录不存在');

    await pool.query(
      'UPDATE cheat_detection SET resolved = 1, action_taken = ? WHERE id = ?',
      [action || 'none', cheatId]
    );

    if (action === 'ban') {
      await pool.query(
        'UPDATE users SET status = 0, ban_reason = ? WHERE id = ?',
        ['反作弊系统封禁', cheat[0].user_id]
      );
    }

    return success(res, null, '处理完成');
  } catch (err) { next(err); }
});

// GET /api/admin/items - 物品配置列表
router.get('/items', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { type, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];
    if (type) { where += ' AND type = ?'; params.push(type); }

    const [rows] = await pool.query(
      `SELECT * FROM items WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    return success(res, rows, '物品列表');
  } catch (err) { next(err); }
});

// POST /api/admin/items - 创建/编辑物品
router.post('/items', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { id, name, type, sub_type, rarity, description, icon, stackable,
            max_stack, sell_price, buy_price, use_effect, equip_slot, equip_stats,
            level_req, realm_req, tradeable } = req.body;

    if (!name || !type) return fail(res, '名称和类型必填');

    if (id) {
      // 编辑
      await pool.query(
        `UPDATE items SET name=?, type=?, sub_type=?, rarity=?, description=?, icon=?,
         stackable=?, max_stack=?, sell_price=?, buy_price=?, use_effect=?, equip_slot=?,
         equip_stats=?, level_req=?, realm_req=?, tradeable=? WHERE id=?`,
        [name, type, sub_type, rarity||1, description, icon, stackable??1, max_stack||99,
         sell_price||0, buy_price||0, use_effect?JSON.stringify(use_effect):null,
         equip_slot, equip_stats?JSON.stringify(equip_stats):null, level_req||1, realm_req||1,
         tradeable??1, id]
      );
      return success(res, { id }, '物品更新成功');
    } else {
      // 创建
      const [result] = await pool.query(
        `INSERT INTO items (name,type,sub_type,rarity,description,icon,stackable,max_stack,
         sell_price,buy_price,use_effect,equip_slot,equip_stats,level_req,realm_req,tradeable)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [name, type, sub_type, rarity||1, description, icon, stackable??1, max_stack||99,
         sell_price||0, buy_price||0, use_effect?JSON.stringify(use_effect):null,
         equip_slot, equip_stats?JSON.stringify(equip_stats):null, level_req||1, realm_req||1,
         tradeable??1]
      );
      return success(res, { id: result.insertId }, '物品创建成功');
    }
  } catch (err) { next(err); }
});

// GET /api/admin/alms-config - 获取化缘数值配置
router.get('/alms-config', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT config_value FROM game_config WHERE config_name = 'alms_config'"
    );
    if (rows.length === 0) return fail(res, '化缘配置不存在');
    const config = rows[0].config_value;
    return success(res, typeof config === 'string' ? JSON.parse(config) : config, '化缘配置');
  } catch (err) { next(err); }
});

// POST /api/admin/alms-config - 保存化缘数值配置
router.post('/alms-config', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const config = req.body;
    if (!config) return fail(res, '配置数据不能为空');
    await pool.query(
      "INSERT INTO game_config (config_name, config_value) VALUES ('alms_config', ?) " +
      "ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
      [JSON.stringify(config)]
    );
    return success(res, null, '化缘配置保存成功');
  } catch (err) { next(err); }
});

// ==================== 商品管理 ====================

// 获取商品列表
router.get('/shop-products', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;
    
    let whereSql = '';
    let params = [];
    
    if (search) {
      whereSql = 'WHERE name LIKE ? OR item_type LIKE ?';
      params = [`%${search}%`, `%${search}%`];
    }
    
    const [rows] = await pool.query(
      `SELECT * FROM shop_products ${whereSql} ORDER BY sort_order ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM shop_products ${whereSql}`,
      params
    );
    
    return success(res, {
      list: rows,
      total: countResult[0].total,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) { next(err); }
});

// 新增商品
router.post('/shop-products', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { name, icon, description, price, cost, item_type, item_count, level_req, status, sort_order } = req.body;
    
    if (!name || !price || !item_type) {
      return fail(res, '商品名、价格、物品类型不能为空');
    }
    
    const [result] = await pool.query(
      `INSERT INTO shop_products (name, icon, description, price, cost, item_type, item_count, level_req, status, sort_order) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, icon || '📦', description || '', price, cost || 0, item_type, item_count || 1, level_req || 1, status || 1, sort_order || 0]
    );
    
    return success(res, { id: result.insertId }, '添加成功');
  } catch (err) { next(err); }
});

// 更新商品
router.put('/shop-products/:id', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, icon, description, price, cost, item_type, item_count, level_req, status, sort_order } = req.body;
    
    await pool.query(
      `UPDATE shop_products SET name=?, icon=?, description=?, price=?, cost=?, item_type=?, item_count=?, level_req=?, status=?, sort_order=? WHERE id=?`,
      [name, icon, description, price, cost, item_type, item_count, level_req, status, sort_order, id]
    );
    
    return success(res, null, '更新成功');
  } catch (err) { next(err); }
});

// 删除商品
router.delete('/shop-products/:id', authMiddleware, adminCheck, async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM shop_products WHERE id = ?', [id]);
    return success(res, null, '删除成功');
  } catch (err) { next(err); }
});

module.exports = router;
