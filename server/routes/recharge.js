// ============================================
// 充值路由 - 下单/回调/VIP/月卡
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// 充值档位
const PACKAGES = [
  { id: 1, cny: 6,    yuanbao: 60,   bonus: 6,   label: '小试牛刀' },
  { id: 2, cny: 30,   yuanbao: 300,  bonus: 30,  label: '初露锋芒' },
  { id: 3, cny: 68,   yuanbao: 680,  bonus: 80,  label: '渐入佳境' },
  { id: 4, cny: 128,  yuanbao: 1280, bonus: 200, label: '财运亨通' },
  { id: 5, cny: 328,  yuanbao: 3280, bonus: 600, label: '日进斗金' },
  { id: 6, cny: 648,  yuanbao: 6480, bonus: 1500,label: '富甲一方' },
  { id: 7, cny: 30,   yuanbao: 0,    bonus: 0,   label: '月卡（30天每日100元宝）', isMonthly: true },
];

// VIP等级门槛
const VIP_THRESHOLDS = [0, 30, 100, 300, 600, 1000, 2000, 5000, 10000, 30000];

// GET /api/recharge/packages - 充值档位列表
router.get('/packages', authMiddleware, async (req, res, next) => {
  try {
    return success(res, PACKAGES, '充值档位');
  } catch (err) { next(err); }
});

// GET /api/recharge/vip - VIP信息
router.get('/vip', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM player_vip WHERE user_id = ?', [req.userId]);
    if (rows.length === 0) return success(res, { vipLevel: 0 }, 'VIP信息');

    const vip = rows[0];
    // 计算下一级需要的充值额
    const nextThreshold = VIP_THRESHOLDS[vip.vip_level + 1] || null;
    return success(res, {
      ...vip,
      nextLevelThreshold: nextThreshold,
      monthlyCardActive: vip.monthly_card && new Date(vip.monthly_card_end) > new Date(),
    }, 'VIP信息');
  } catch (err) { next(err); }
});

// POST /api/recharge/create - 创建充值订单
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { packageId, channel = 'wechat' } = req.body;
    if (!packageId) return fail(res, '请选择充值档位');

    const pkg = PACKAGES.find(p => p.id === packageId);
    if (!pkg) return fail(res, '无效的充值档位');

    // 生成订单号
    const orderNo = `CS${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

    const [result] = await pool.query(
      `INSERT INTO recharge_orders (order_no, user_id, amount_cny, yuanbao_amount, bonus_yuanbao, channel)
       VALUES (?,?,?,?,?,?)`,
      [orderNo, req.userId, pkg.cny, pkg.yuanbao, pkg.bonus, channel]
    );

    return success(res, {
      orderId: result.insertId,
      orderNo,
      amount: pkg.cny,
      yuanbao: pkg.yuanbao + pkg.bonus,
      channel,
      label: pkg.label,
      // 实际项目中这里返回支付链接/参数
      payUrl: `https://pay.example.com/pay?order=${orderNo}`,
    }, '订单创建成功，请完成支付');
  } catch (err) { next(err); }
});

// POST /api/recharge/callback - 支付回调（模拟）
router.post('/callback', async (req, res, next) => {
  try {
    const { orderNo, tradeNo } = req.body;
    if (!orderNo) return fail(res, '缺少订单号');

    const [orders] = await pool.query(
      "SELECT * FROM recharge_orders WHERE order_no = ? AND status = 'pending'",
      [orderNo]
    );
    if (orders.length === 0) return fail(res, '订单不存在或已处理');
    const order = orders[0];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 更新订单状态
      await conn.query(
        "UPDATE recharge_orders SET status = 'paid', trade_no = ?, paid_at = NOW() WHERE id = ?",
        [tradeNo || 'SIM_' + Date.now(), order.id]
      );

      // 判断是否月卡
      const pkg = PACKAGES.find(p => p.cny == order.amount_cny && p.isMonthly);
      if (pkg && pkg.isMonthly) {
        // 月卡：设置30天有效期，每天登录领100元宝
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        await conn.query(
          `UPDATE player_vip SET monthly_card = 1, monthly_card_end = ?,
           total_recharge = total_recharge + ? WHERE user_id = ?`,
          [endDate, order.amount_cny, order.user_id]
        );
        // 立即发放今天的100元宝
        await conn.query(
          'UPDATE player_data SET yuanbao = yuanbao + 100 WHERE user_id = ?',
          [order.user_id]
        );
      } else {
        // 普通充值：发放元宝
        const totalYuanbao = order.yuanbao_amount + order.bonus_yuanbao;
        await conn.query(
          'UPDATE player_data SET yuanbao = yuanbao + ? WHERE user_id = ?',
          [totalYuanbao, order.user_id]
        );

        // 更新VIP
        await conn.query(
          'UPDATE player_vip SET total_recharge = total_recharge + ? WHERE user_id = ?',
          [order.amount_cny, order.user_id]
        );
      }

      // 首充标记
      await conn.query(
        'UPDATE player_vip SET first_recharge = 1 WHERE user_id = ? AND first_recharge = 0',
        [order.user_id]
      );

      // 重算VIP等级
      const [vip] = await conn.query('SELECT total_recharge FROM player_vip WHERE user_id = ?', [order.user_id]);
      let newLevel = 0;
      for (let i = VIP_THRESHOLDS.length - 1; i >= 0; i--) {
        if (vip[0].total_recharge >= VIP_THRESHOLDS[i]) { newLevel = i; break; }
      }
      await conn.query('UPDATE player_vip SET vip_level = ? WHERE user_id = ?', [newLevel, order.user_id]);

      // 日志
      await conn.query(
        'INSERT INTO logs (user_id, action, detail) VALUES (?,?,?)',
        [order.user_id, 'recharge', JSON.stringify({
          orderNo, amount: order.amount_cny, yuanbao: order.yuanbao_amount + order.bonus_yuanbao
        })]
      );

      await conn.commit();
      return success(res, { orderNo, status: 'paid' }, '充值成功！');
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

// GET /api/recharge/orders - 我的充值记录
router.get('/orders', authMiddleware, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const [rows] = await pool.query(
      `SELECT order_no, amount_cny, yuanbao_amount, bonus_yuanbao, channel, status, paid_at, created_at
       FROM recharge_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.userId, parseInt(limit), parseInt(offset)]
    );
    return success(res, rows, '充值记录');
  } catch (err) { next(err); }
});

module.exports = router;
