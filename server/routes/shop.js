const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { pool } = require('../config/database');
const { success, fail } = require('../utils/helpers');

// ==================== 玩家商城API ====================

// GET /api/shop/list - 获取商品列表（玩家可见）
router.get('/list', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, icon, description, price, item_type, item_count, level_req FROM shop_products WHERE status = 1 ORDER BY sort_order ASC'
    );
    return success(res, rows);
  } catch (err) { next(err); }
});

// POST /api/shop/buy - 购买商品
router.post('/buy', authMiddleware, async (req, res, next) => {
  try {
    const { product_id, count = 1 } = req.body;
    
    if (!product_id) return fail(res, '请选择商品');
    
    // 获取商品信息
    const [products] = await pool.query(
      'SELECT * FROM shop_products WHERE id = ? AND status = 1',
      [product_id]
    );
    
    if (products.length === 0) return fail(res, '商品不存在或已下架');
    
    const product = products[0];
    const totalPrice = product.price * count;
    
    // 检查玩家金钱
    const [playerRows] = await pool.query(
      'SELECT gold, level, incense_sticks, candles, gold_paper, fruits FROM player_data WHERE user_id = ?',
      [req.user.userId]
    );
    
    if (playerRows.length === 0) return fail(res, '玩家数据不存在');
    
    const player = playerRows[0];
    
    // 检查等级
    if (player.level < product.level_req) {
      return fail(res, `需要达到${product.level_req}级才能购买`);
    }
    
    // 检查金钱
    if (Number(player.gold) < totalPrice) {
      return fail(res, '香火钱不足');
    }
    
    // 扣除金钱，增加道具
    await pool.query(
      'UPDATE player_data SET gold = gold - ? WHERE user_id = ?',
      [totalPrice, req.user.userId]
    );
    
    let updateField = '';
    switch (product.item_type) {
      case 'incense_sticks':
        updateField = 'incense_sticks = incense_sticks + ?';
        break;
      case 'candles':
        updateField = 'candles = candles + ?';
        break;
      case 'gold_paper':
        updateField = 'gold_paper = gold_paper + ?';
        break;
      case 'fruits':
        updateField = 'fruits = fruits + ?';
        break;
      case 'gold':
        updateField = 'gold = gold + ?';
        break;
      case 'yuanbao':
        updateField = 'yuanbao = yuanbao + ?';
        break;
      default:
        return fail(res, '未知物品类型');
    }
    
    await pool.query(
      `UPDATE player_data SET ${updateField} WHERE user_id = ?`,
      [product.item_count * count, req.user.userId]
    );
    
    // 记录日志
    await pool.query(
      'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
      [req.user.userId, 'shop_buy', JSON.stringify({ product_id, product_name: product.name, count, totalPrice })]
    );

    // 更新消费任务进度
    try {
      const [consumeTasks] = await pool.query(
        "SELECT * FROM quests WHERE target_type = 'consume_today' AND type = 'daily' AND is_active = 1"
      );
      for (const task of consumeTasks) {
        const [progressRows] = await pool.query(
          'SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ?',
          [req.user.userId, task.id]
        );
        let currentProgress = progressRows.length > 0 ? (progressRows[0].progress || 0) : 0;
        currentProgress += totalPrice; // 累加消费金额
        if (progressRows.length > 0) {
          await pool.query(
            'UPDATE quest_progress SET progress = ? WHERE user_id = ? AND quest_id = ?',
            [currentProgress, req.user.userId, task.id]
          );
        } else {
          await pool.query(
            'INSERT INTO quest_progress (user_id, quest_id, progress, claimed) VALUES (?, ?, ?, 0)',
            [req.user.userId, task.id, currentProgress]
          );
        }
        // 注意：活跃值在 quests.js 领取奖励时统一添加，不再在这里添加
      }
    } catch (err) {
      console.error('更新消费任务失败:', err);
    }

    return success(res, {
      product_name: product.name,
      count,
      total_price: totalPrice,
      new_gold: Number(player.gold) - totalPrice
    }, '购买成功');

  } catch (err) { next(err); }
});

module.exports = router;
