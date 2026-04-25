const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// 所有代理API都需要登录
router.use(authMiddleware);

// ============================================
// 代理系统 API
// ============================================

// 辅助函数：生成5位邀请码
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// 辅助函数：生成16位激活码（分4组）
function generateActivationCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 16; i++) {
        if (i > 0 && i % 4 === 0) code += '-';
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// 辅助函数：检查邀请码是否存在
async function getPlayerIdByInviteCode(inviteCode) {
    const [rows] = await pool.query(
        'SELECT player_id FROM player_data WHERE invitation_code = ? LIMIT 1',
        [inviteCode]
    );
    return rows.length > 0 ? rows[0].player_id : null;
}

// 辅助函数：获取代理等级配置
async function getAgentConfig(level) {
    const [rows] = await pool.query(
        'SELECT * FROM agent_commission_config WHERE level = ?',
        [level]
    );
    return rows[0] || null;
}

// 辅助函数：获取升级条件配置
async function getUpgradeConfig(targetLevel) {
    const [rows] = await pool.query(
        'SELECT * FROM agent_upgrade_config WHERE target_level = ?',
        [targetLevel]
    );
    return rows[0] || null;
}

// 辅助函数：计算代理等级
async function calculateAgentLevel(playerId) {
    // 获取当前等级
    const [agentRows] = await pool.query(
        'SELECT level FROM agents WHERE player_id = ?',
        [playerId]
    );
    const currentLevel = agentRows.length > 0 ? agentRows[0].level : 1;
    
    // 检查是否能升级到下一等级
    for (let targetLevel = currentLevel + 1; targetLevel <= 6; targetLevel++) {
        const config = await getUpgradeConfig(targetLevel);
        if (!config) continue;
        
        // 检查三个条件
        const canUpgrade = await checkUpgradeConditions(playerId, config);
        if (canUpgrade) {
            await pool.query(
                'UPDATE agents SET level = ?, updated_at = NOW() WHERE player_id = ?',
                [targetLevel, playerId]
            );
            return targetLevel;
        } else {
            break; // 条件不满足，不再检查更高等级
        }
    }
    
    return currentLevel;
}

// 辅助函数：检查升级条件
async function checkUpgradeConditions(playerId, config) {
    // 获取代理数据
    const [agentRows] = await pool.query(
        'SELECT * FROM agents WHERE player_id = ?',
        [playerId]
    );
    if (agentRows.length === 0) return false;
    const agent = agentRows[0];
    
    // 条件1：直推单数
    if (config.direct_orders_required > 0 && agent.direct_orders < config.direct_orders_required) {
        return false;
    }
    
    // 条件2：团队单数
    if (config.team_orders_required > 0 && agent.team_orders < config.team_orders_required) {
        return false;
    }
    
    // 条件3：高级人数（需要指定等级的下级代理数量）
    if (config.high_level_count_required > 0 && config.high_level_type > 0) {
        const [countRows] = await pool.query(`
            SELECT COUNT(*) as cnt FROM agents a
            INNER JOIN agent_relations ar ON a.player_id = ar.player_id
            WHERE ar.superior_id = ? AND a.level = ?
        `, [playerId, config.high_level_type]);
        
        if (countRows[0].cnt < config.high_level_count_required) {
            return false;
        }
    }
    
    return true;
}

// 辅助函数：计算并发放佣金
async function calculateAndGrantCommission(orderId, buyerId, sellerId) {
    if (sellerId === 0) return; // 公司销售不发放佣金
    
    // 获取卖家代理等级
    const [agentRows] = await pool.query(
        'SELECT * FROM agents WHERE player_id = ?',
        [sellerId]
    );
    if (agentRows.length === 0) return;
    const agent = agentRows[0];
    const level = agent.level;
    
    // 获取佣金配置
    const config = await getAgentConfig(level);
    if (!config) return;
    
    const orderAmount = 999;
    
    // 1. 基础佣金 - 直推 (18%)
    if (config.direct_commission > 0) {
        const directCommission = orderAmount * config.direct_commission / 100;
        await pool.query(`
            INSERT INTO commissions (agent_id, order_id, level, amount, type, status)
            VALUES (?, ?, 1, ?, 'base', 'pending')
        `, [sellerId, orderId, directCommission]);
    }
    
    // 2. 向上查找上级，发放间推佣金
    const [relationRows] = await pool.query(
        'SELECT * FROM agent_relations WHERE player_id = ?',
        [sellerId]
    );
    
    if (relationRows.length > 0 && relationRows[0].superior_id > 0) {
        const superiorId = relationRows[0].superior_id;
        
        // 检查上级是否是代理
        const [superiorAgentRows] = await pool.query(
            'SELECT * FROM agents WHERE player_id = ?',
            [superiorId]
        );
        
        if (superiorAgentRows.length > 0) {
            const superiorLevel = superiorAgentRows[0].level;
            const superiorConfig = await getAgentConfig(superiorLevel);
            
            if (superiorConfig && superiorConfig.indirect_commission > 0) {
                const indirectCommission = orderAmount * superiorConfig.indirect_commission / 100;
                await pool.query(`
                    INSERT INTO commissions (agent_id, order_id, level, amount, type, status)
                    VALUES (?, ?, 2, ?, 'base', 'pending')
                `, [superiorId, orderId, indirectCommission]);
            }
            
            // 3. 团队奖金（Lv.3+）
            if (superiorConfig && superiorConfig.team_bonus > 0 && superiorConfig.team_bonus_generations > 0) {
                await calculateTeamBonus(superiorId, orderId, superiorLevel, superiorConfig.team_bonus_generations, orderAmount);
            }
        }
    }
}

// 辅助函数：计算团队奖金（递归向上）
async function calculateTeamBonus(agentId, orderId, agentLevel, remainingGenerations, orderAmount) {
    if (remainingGenerations <= 0) return;
    
    const config = await getAgentConfig(agentLevel);
    if (!config || config.team_bonus <= 0) return;
    
    const bonus = orderAmount * config.team_bonus / 100;
    await pool.query(`
        INSERT INTO commissions (agent_id, order_id, level, amount, type, status)
        VALUES (?, ?, 1, ?, 'team_bonus', 'pending')
    `, [agentId, orderId, bonus]);
    
    // 继续向上查找上级
    const [relationRows] = await pool.query(
        'SELECT * FROM agent_relations WHERE player_id = ?',
        [agentId]
    );
    
    if (relationRows.length > 0 && relationRows[0].superior_id > 0) {
        const [superiorAgentRows] = await pool.query(
            'SELECT * FROM agents WHERE player_id = ?',
            [relationRows[0].superior_id]
        );
        
        if (superiorAgentRows.length > 0) {
            const superiorLevel = superiorAgentRows[0].level;
            const superiorConfig = await getAgentConfig(superiorLevel);
            
            if (superiorConfig && superiorConfig.team_bonus > 0) {
                const superiorBonus = orderAmount * superiorConfig.team_bonus / 100;
                await pool.query(`
                    INSERT INTO commissions (agent_id, order_id, level, amount, type, status)
                    VALUES (?, ?, 1, ?, 'team_bonus', 'pending')
                `, [relationRows[0].superior_id, orderId, superiorBonus]);
                
                // 继续向上（无限代）
                await calculateTeamBonus(relationRows[0].superior_id, orderId, superiorLevel, remainingGenerations - 1, orderAmount);
            }
        }
    }
}

// 辅助函数：更新团队订单数
async function updateTeamOrders(agentId) {
    // 更新直接推荐人的团队订单数
    const [relationRows] = await pool.query(
        'SELECT superior_id FROM agent_relations WHERE player_id = ?',
        [agentId]
    );
    
    if (relationRows.length > 0 && relationRows[0].superior_id > 0) {
        const superiorId = relationRows[0].superior_id;
        
        // 更新上级团队的订单数
        await pool.query(`
            UPDATE agents SET team_orders = team_orders + 1, updated_at = NOW()
            WHERE player_id = ?
        `, [superiorId]);
        
        // 递归向上更新
        await updateTeamOrders(superiorId);
    }
}

// ============================================
// API 接口
// ============================================

/**
 * POST /api/agent/activate
 * 激活代理功能
 * Body: { activation_code, superior_invite_code }
 */
router.post('/activate', async (req, res) => {
    try {
        const { activation_code, superior_invite_code } = req.body;
        const userId = req.userId;
        
        // 验证激活码
        if (!activation_code) {
            return res.json({ code: 1, message: '请输入激活码' });
        }
        
        // 查找激活码
        const [codeRows] = await pool.query(
            'SELECT * FROM activation_codes WHERE code = ?',
            [activation_code]
        );
        
        if (codeRows.length === 0) {
            return res.json({ code: 2, message: '激活码无效' });
        }
        
        const activationRecord = codeRows[0];
        
        if (activationRecord.status === 'used') {
            return res.json({ code: 3, message: '激活码已被使用' });
        }
        
        if (activationRecord.status === 'cancelled') {
            return res.json({ code: 4, message: '激活码已作废' });
        }
        
        // 检查用户是否已经是代理
        const [existingAgent] = await pool.query(
            'SELECT * FROM agents WHERE player_id = ?',
            [userId]
        );
        
        if (existingAgent.length > 0) {
            return res.json({ code: 5, message: '您已经是代理了' });
        }
        
        // 获取用户player_id
        const [userRows] = await pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (userRows.length === 0) {
            return res.json({ code: 6, message: '用户不存在' });
        }
        
        const playerId = userRows[0].player_id;
        
        // 确定上级
        let superiorId = 0; // 默认是公司
        let sellerId = 0;
        
        if (superior_invite_code) {
            const superiorPlayerId = await getPlayerIdByInviteCode(superior_invite_code);
            if (superiorPlayerId) {
                if (superiorPlayerId === playerId) {
                    return res.json({ code: 7, message: '不能绑定自己的邀请码' });
                }
                superiorId = superiorPlayerId;
                
                // 获取上级的代理信息
                const [superiorAgent] = await pool.query(
                    'SELECT id FROM agents WHERE player_id = ?',
                    [superiorId]
                );
                if (superiorAgent.length > 0) {
                    sellerId = superiorId;
                }
            }
        }
        
        // 创建订单
        const [orderResult] = await pool.query(`
            INSERT INTO orders (buyer_id, seller_id, activation_code_id, amount, status, paid_at)
            VALUES (?, ?, ?, 999.00, 'paid', NOW())
        `, [playerId, sellerId, activationRecord.id]);
        
        const orderId = orderResult.insertId;
        
        // 标记激活码已使用
        await pool.query(
            'UPDATE activation_codes SET status = ?, used_by = ?, used_at = NOW() WHERE id = ?',
            ['used', playerId, activationRecord.id]
        );
        
        // 创建代理关系（绑定上下级）
        await pool.query(`
            INSERT INTO agent_relations (player_id, superior_id, level, activation_code_id)
            VALUES (?, ?, 1, ?)
        `, [playerId, superiorId, activationRecord.id]);
        
        // 创建代理记录
        await pool.query(`
            INSERT INTO agents (player_id, level, direct_orders, team_orders, high_level_count, status)
            VALUES (?, 1, 0, 0, 0, 'normal')
        `, [playerId]);
        
        // 如果有上级，更新上级的直推订单数和团队订单数
        if (superiorId > 0) {
            // 更新上级的直推单数
            await pool.query(`
                UPDATE agents SET direct_orders = direct_orders + 1, updated_at = NOW()
                WHERE player_id = ?
            `, [superiorId]);
            
            // 更新上级及其上级的团队订单数
            await updateTeamOrders(superiorId);
            
            // 重新计算上级的等级
            await calculateAgentLevel(superiorId);
            
            // 计算并发放佣金
            await calculateAndGrantCommission(orderId, playerId, superiorId);
        }
        
        res.json({ 
            code: 0, 
            message: '激活成功',
            data: {
                player_id: playerId,
                superior_id: superiorId,
                order_id: orderId
            }
        });
        
    } catch (error) {
        console.error('激活代理失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/agent/my-data
 * 获取我的代理数据
 */
router.get('/my-data', async (req, res) => {
    // 禁用缓存
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    try {
        console.log('[/my-data] req.user:', JSON.stringify(req.user));
        const userId = req.userId;
        console.log('[/my-data] userId:', userId);
        
        // 获取玩家ID
        const [userRows] = await pool.query(
            'SELECT player_id, invitation_code FROM player_data WHERE user_id = ?',
            [userId]
        );
        console.log('[/my-data] userRows:', JSON.stringify(userRows));
        
        if (userRows.length === 0) {
            return res.json({ code: 1, message: '用户不存在' });
        }
        
        const playerId = userRows[0].player_id;
        const invitationCode = userRows[0].invitation_code;
        console.log('[/my-data] playerId:', playerId);
        
        // 获取代理信息
        const [agentRows] = await pool.query(
            'SELECT * FROM agents WHERE player_id = ?',
            [playerId]
        );
        console.log('[/my-data] agentRows count:', agentRows.length);
        
        if (agentRows.length === 0) {
            return res.json({ 
                code: 2, 
                message: '您还不是代理',
                data: {
                    is_agent: false
                }
            });
        }
        
        const agent = agentRows[0];
        
        // 获取佣金统计
        const [commissionStats] = await pool.query(`
            SELECT 
                SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'settled' THEN amount ELSE 0 END) as settled,
                SUM(CASE WHEN status = 'withdrawn' THEN amount ELSE 0 END) as withdrawn,
                SUM(amount) as total
            FROM commissions WHERE agent_id = ?
        `, [agent.id]);
        
        // 获取直推订单数
        const [directOrders] = await pool.query(
            'SELECT COUNT(*) as cnt FROM orders WHERE seller_id = ? AND status = \'paid\'',
            [playerId]
        );
        
        // 计算升级进度
        const upgradeProgress = {
            current_level: agent.level,
            next_level: agent.level < 6 ? agent.level + 1 : null,
            conditions: []
        };
        
        if (agent.level < 6) {
            const nextConfig = await getUpgradeConfig(agent.level + 1);
            if (nextConfig) {
                // 直推条件
                const [superiorAgentRows] = await pool.query(
                    'SELECT level FROM agents WHERE player_id = ?',
                    [playerId]
                );
                
                upgradeProgress.conditions.push({
                    name: '直推单数',
                    current: agent.direct_orders,
                    required: nextConfig.direct_orders_required,
                    met: agent.direct_orders >= nextConfig.direct_orders_required
                });
                
                // 团队条件
                upgradeProgress.conditions.push({
                    name: '团队单数',
                    current: agent.team_orders,
                    required: nextConfig.team_orders_required,
                    met: agent.team_orders >= nextConfig.team_orders_required
                });
                
                // 高级人数条件
                if (nextConfig.high_level_count_required > 0) {
                    const [countRows] = await pool.query(`
                        SELECT COUNT(*) as cnt FROM agents a
                        INNER JOIN agent_relations ar ON a.player_id = ar.player_id
                        WHERE ar.superior_id = ? AND a.level = ?
                    `, [playerId, nextConfig.high_level_type]);
                    
                    upgradeProgress.conditions.push({
                        name: `Lv.${nextConfig.high_level_type}人数`,
                        current: countRows[0].cnt,
                        required: nextConfig.high_level_count_required,
                        met: countRows[0].cnt >= nextConfig.high_level_count_required
                    });
                }
            }
        }
        
        res.json({
            code: 0,
            message: 'success',
            data: {
                is_agent: true,
                level: agent.level,
                invitation_code: invitationCode,
                direct_orders: agent.direct_orders,
                team_orders: agent.team_orders,
                commission: {
                    pending: parseFloat(commissionStats[0].pending) || 0,
                    settled: parseFloat(commissionStats[0].settled) || 0,
                    withdrawn: parseFloat(commissionStats[0].withdrawn) || 0,
                    total: parseFloat(commissionStats[0].total) || 0
                },
                upgrade_progress: upgradeProgress,
                status: agent.status
            }
        });
        
    } catch (error) {
        console.error('获取代理数据失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/agent/my-team
 * 获取我的团队数据
 * Query: month (格式: 2026-04)
 */
router.get('/my-team', async (req, res) => {
    try {
        const userId = req.userId;
        const { month } = req.query;
        
        // 获取玩家ID
        const [userRows] = await pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (userRows.length === 0) {
            return res.json({ code: 1, message: '用户不存在' });
        }
        
        const playerId = userRows[0].player_id;
        
        // 获取代理信息
        const [agentRows] = await pool.query(
            'SELECT * FROM agents WHERE player_id = ?',
            [playerId]
        );
        
        if (agentRows.length === 0) {
            return res.json({ code: 2, message: '您还不是代理' });
        }
        
        // 获取团队总订单数
        const [totalOrders] = await pool.query(`
            SELECT COUNT(*) as cnt FROM orders o
            INNER JOIN agent_relations ar ON o.buyer_id = ar.player_id
            WHERE ar.superior_id = ? AND o.status = 'paid'
        `, [playerId]);
        
        // 按月份统计团队销售额
        let monthlySql = `
            SELECT 
                DATE_FORMAT(o.paid_at, '%Y-%m') as month,
                COUNT(*) as order_count,
                SUM(o.amount) as total_amount
            FROM orders o
            INNER JOIN agent_relations ar ON o.buyer_id = ar.player_id
            WHERE ar.superior_id = ? AND o.status = 'paid'
        `;
        const params = [playerId];
        
        if (month) {
            monthlySql += ' AND DATE_FORMAT(o.paid_at, \'%Y-%m\') = ?';
            params.push(month);
        }
        
        monthlySql += ' GROUP BY DATE_FORMAT(o.paid_at, \'%Y-%m\') ORDER BY month DESC';
        
        const [monthlyStats] = await pool.query(monthlySql, params);
        
        res.json({
            code: 0,
            message: 'success',
            data: {
                team_total_orders: totalOrders[0].cnt,
                monthly_stats: monthlyStats.map(row => ({
                    month: row.month,
                    order_count: row.order_count,
                    total_amount: parseFloat(row.total_amount) || 0
                }))
            }
        });
        
    } catch (error) {
        console.error('获取团队数据失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * POST /api/agent/withdraw
 * 申请提现
 * Body: { amount }
 */
router.post('/withdraw', async (req, res) => {
    try {
        const userId = req.userId;
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.json({ code: 1, message: '请输入正确的提现金额' });
        }
        
        // 获取玩家ID
        const [userRows] = await pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (userRows.length === 0) {
            return res.json({ code: 2, message: '用户不存在' });
        }
        
        const playerId = userRows[0].player_id;
        
        // 获取代理信息
        const [agentRows] = await pool.query(
            'SELECT * FROM agents WHERE player_id = ?',
            [playerId]
        );
        
        if (agentRows.length === 0) {
            return res.json({ code: 3, message: '您还不是代理' });
        }
        
        const agent = agentRows[0];
        
        // 计算可提现金额（待结算 + 已结算 - 已提现）
        const [balanceRows] = await pool.query(`
            SELECT 
                SUM(CASE WHEN status IN ('pending', 'settled') THEN amount ELSE 0 END) as available
            FROM commissions WHERE agent_id = ?
        `, [agent.id]);
        
        const available = parseFloat(balanceRows[0].available) || 0;
        
        if (available < amount) {
            return res.json({ code: 4, message: '可提现余额不足' });
        }
        
        // 创建提现申请
        await pool.query(`
            INSERT INTO withdrawals (agent_id, amount, status, apply_at)
            VALUES (?, ?, 'pending', NOW())
        `, [agent.id, amount]);
        
        res.json({ 
            code: 0, 
            message: '提现申请已提交',
            data: { amount }
        });
        
    } catch (error) {
        console.error('申请提现失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/agent/withdraw-records
 * 获取提现记录
 */
router.get('/withdraw-records', async (req, res) => {
    try {
        const userId = req.userId;
        
        // 获取玩家ID
        const [userRows] = await pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (userRows.length === 0) {
            return res.json({ code: 1, message: '用户不存在' });
        }
        
        const playerId = userRows[0].player_id;
        
        // 获取代理信息
        const [agentRows] = await pool.query(
            'SELECT * FROM agents WHERE player_id = ?',
            [playerId]
        );
        
        if (agentRows.length === 0) {
            return res.json({ code: 2, message: '您还不是代理' });
        }
        
        // 获取提现记录
        const [records] = await pool.query(`
            SELECT * FROM withdrawals 
            WHERE agent_id = ? 
            ORDER BY apply_at DESC
            LIMIT 50
        `, [agentRows[0].id]);
        
        res.json({
            code: 0,
            message: 'success',
            data: records.map(r => ({
                id: r.id,
                amount: parseFloat(r.amount),
                status: r.status,
                apply_at: r.apply_at,
                paid_at: r.paid_at
            }))
        });
        
    } catch (error) {
        console.error('获取提现记录失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/agent/commission-records
 * 获取佣金记录
 */
router.get('/commission-records', async (req, res) => {
    try {
        const userId = req.userId;
        const { limit = 50 } = req.query;
        
        // 获取玩家ID
        const [userRows] = await pool.query(
            'SELECT player_id FROM player_data WHERE user_id = ?',
            [userId]
        );
        
        if (userRows.length === 0) {
            return res.json({ code: 1, message: '用户不存在' });
        }
        
        const playerId = userRows[0].player_id;
        
        // 获取代理信息
        const [agentRows] = await pool.query(
            'SELECT * FROM agents WHERE player_id = ?',
            [playerId]
        );
        
        if (agentRows.length === 0) {
            return res.json({ code: 2, message: '您还不是代理' });
        }
        
        // 获取佣金记录
        const [records] = await pool.query(`
            SELECT c.*, o.buyer_id, o.paid_at
            FROM commissions c
            INNER JOIN orders o ON c.order_id = o.id
            WHERE c.agent_id = ?
            ORDER BY c.created_at DESC
            LIMIT ?
        `, [agentRows[0].id, parseInt(limit)]);
        
        res.json({
            code: 0,
            message: 'success',
            data: records.map(r => ({
                id: r.id,
                order_id: r.order_id,
                buyer_id: r.buyer_id,
                level: r.level,
                amount: parseFloat(r.amount),
                type: r.type,
                status: r.status,
                created_at: r.created_at,
                paid_at: r.paid_at
            }))
        });
        
    } catch (error) {
        console.error('获取佣金记录失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

// ============================================
// 管理后台 API (需要管理员权限)
// ============================================

/**
 * POST /api/admin/agent/generate-codes
 * 生成激活码
 * Body: { count, seller_id }
 */
router.post('/admin/generate-codes', async (req, res) => {
    try {
        const { count = 10, seller_id = 0 } = req.body;
        
        const codes = [];
        for (let i = 0; i < count; i++) {
            const code = generateActivationCode();
            await pool.query(
                'INSERT INTO activation_codes (code, seller_id) VALUES (?, ?)',
                [code, seller_id]
            );
            codes.push(code);
        }
        
        res.json({
            code: 0,
            message: '生成成功',
            data: { codes }
        });
        
    } catch (error) {
        console.error('生成激活码失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/admin/agent/codes
 * 获取激活码列表
 * Query: status (unused/used/cancelled)
 */
router.get('/admin/codes', async (req, res) => {
    try {
        const { status } = req.query;
        
        let sql = 'SELECT * FROM activation_codes WHERE 1=1';
        const params = [];
        
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        
        sql += ' ORDER BY created_at DESC LIMIT 100';
        
        const [codes] = await pool.query(sql, params);
        
        res.json({
            code: 0,
            message: 'success',
            data: codes
        });
        
    } catch (error) {
        console.error('获取激活码列表失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * POST /api/admin/agent/codes/:id/cancel
 * 作废激活码
 */
router.post('/admin/codes/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query(
            'UPDATE activation_codes SET status = ? WHERE id = ? AND status = ?',
            ['cancelled', id, 'unused']
        );
        
        res.json({ code: 0, message: '作废成功' });
        
    } catch (error) {
        console.error('作废激活码失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/admin/agents
 * 获取代理列表
 */
router.get('/admin/agents', async (req, res) => {
    try {
        const [agents] = await pool.query(`
            SELECT a.*, pd.nickname, pd.invitation_code
            FROM agents a
            INNER JOIN player_data pd ON a.player_id = pd.player_id
            ORDER BY a.level DESC, a.direct_orders DESC
            LIMIT 100
        `);
        
        res.json({
            code: 0,
            message: 'success',
            data: agents
        });
        
    } catch (error) {
        console.error('获取代理列表失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/admin/agents/:playerId/tree
 * 获取代理团队树
 */
router.get('/admin/agents/:playerId/tree', async (req, res) => {
    try {
        const { playerId } = req.params;
        
        // 获取直接下级
        const [subordinates] = await pool.query(`
            SELECT a.*, pd.nickname, pd.invitation_code
            FROM agent_relations ar
            INNER JOIN agents a ON ar.player_id = a.player_id
            INNER JOIN player_data pd ON ar.player_id = pd.player_id
            WHERE ar.superior_id = ?
        `, [playerId]);
        
        res.json({
            code: 0,
            message: 'success',
            data: subordinates
        });
        
    } catch (error) {
        console.error('获取代理团队树失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/admin/orders
 * 获取订单列表
 */
router.get('/admin/orders', async (req, res) => {
    try {
        const { status, month } = req.query;
        
        let sql = `
            SELECT o.*, pd_buyer.nickname as buyer_nickname, pd_seller.nickname as seller_nickname
            FROM orders o
            LEFT JOIN player_data pd_buyer ON o.buyer_id = pd_buyer.player_id
            LEFT JOIN player_data pd_seller ON o.seller_id = pd_seller.player_id
            WHERE 1=1
        `;
        const params = [];
        
        if (status) {
            sql += ' AND o.status = ?';
            params.push(status);
        }
        
        if (month) {
            sql += ' AND DATE_FORMAT(o.paid_at, \'%Y-%m\') = ?';
            params.push(month);
        }
        
        sql += ' ORDER BY o.created_at DESC LIMIT 100';
        
        const [orders] = await pool.query(sql, params);
        
        res.json({
            code: 0,
            message: 'success',
            data: orders
        });
        
    } catch (error) {
        console.error('获取订单列表失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/admin/commissions
 * 获取佣金列表
 */
router.get('/admin/commissions', async (req, res) => {
    try {
        const [commissions] = await pool.query(`
            SELECT c.*, pd.nickname as agent_nickname
            FROM commissions c
            INNER JOIN agents a ON c.agent_id = a.id
            INNER JOIN player_data pd ON a.player_id = pd.player_id
            ORDER BY c.created_at DESC
            LIMIT 100
        `);
        
        res.json({
            code: 0,
            message: 'success',
            data: commissions
        });
        
    } catch (error) {
        console.error('获取佣金列表失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/admin/withdrawals
 * 获取提现申请列表
 */
router.get('/admin/withdrawals', async (req, res) => {
    try {
        const { status } = req.query;
        
        let sql = `
            SELECT w.*, pd.nickname as agent_nickname
            FROM withdrawals w
            INNER JOIN agents a ON w.agent_id = a.id
            INNER JOIN player_data pd ON a.player_id = pd.player_id
            WHERE 1=1
        `;
        const params = [];
        
        if (status) {
            sql += ' AND w.status = ?';
            params.push(status);
        }
        
        sql += ' ORDER BY w.apply_at DESC LIMIT 100';
        
        const [withdrawals] = await pool.query(sql, params);
        
        res.json({
            code: 0,
            message: 'success',
            data: withdrawals
        });
        
    } catch (error) {
        console.error('获取提现列表失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * POST /api/admin/withdrawals/:id/approve
 * 审批提现（标记已打款）
 */
router.post('/admin/withdrawals/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { remark } = req.body;
        
        // 更新提现状态
        await pool.query(
            'UPDATE withdrawals SET status = ?, paid_at = NOW(), remark = ? WHERE id = ?',
            ['paid', remark || '', id]
        );
        
        // 更新相关佣金的结算状态
        const [withdrawalRows] = await pool.query('SELECT * FROM withdrawals WHERE id = ?', [id]);
        if (withdrawalRows.length > 0) {
            const withdrawal = withdrawalRows[0];
            
            // 将该代理的待结算佣金标记为已提现
            await pool.query(`
                UPDATE commissions SET status = 'withdrawn', settled_at = NOW()
                WHERE agent_id = ? AND status IN ('pending', 'settled')
            `, [withdrawal.agent_id]);
        }
        
        res.json({ code: 0, message: '操作成功' });
        
    } catch (error) {
        console.error('审批提现失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/admin/config/commission
 * 获取佣金配置
 */
router.get('/admin/config/commission', async (req, res) => {
    try {
        const [configs] = await pool.query('SELECT * FROM agent_commission_config ORDER BY level');
        res.json({ code: 0, message: 'success', data: configs });
    } catch (error) {
        console.error('获取佣金配置失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * POST /api/admin/config/commission
 * 更新佣金配置
 */
router.post('/admin/config/commission', async (req, res) => {
    try {
        const configs = req.body;
        
        for (const config of configs) {
            await pool.query(`
                UPDATE agent_commission_config 
                SET direct_commission = ?, indirect_commission = ?, team_bonus = ?, team_bonus_generations = ?
                WHERE level = ?
            `, [config.direct_commission, config.indirect_commission, config.team_bonus, config.team_bonus_generations, config.level]);
        }
        
        res.json({ code: 0, message: '更新成功' });
        
    } catch (error) {
        console.error('更新佣金配置失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * GET /api/admin/config/upgrade
 * 获取升级条件配置
 */
router.get('/admin/config/upgrade', async (req, res) => {
    try {
        const [configs] = await pool.query('SELECT * FROM agent_upgrade_config ORDER BY target_level');
        res.json({ code: 0, message: 'success', data: configs });
    } catch (error) {
        console.error('获取升级条件配置失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

/**
 * POST /api/admin/config/upgrade
 * 更新升级条件配置
 */
router.post('/admin/config/upgrade', async (req, res) => {
    try {
        const configs = req.body;
        
        for (const config of configs) {
            await pool.query(`
                UPDATE agent_upgrade_config 
                SET direct_orders_required = ?, team_orders_required = ?, high_level_count_required = ?, high_level_type = ?
                WHERE target_level = ?
            `, [config.direct_orders_required, config.team_orders_required, config.high_level_count_required, config.high_level_type, config.target_level]);
        }
        
        res.json({ code: 0, message: '更新成功' });
        
    } catch (error) {
        console.error('更新升级条件配置失败:', error);
        res.json({ code: 500, message: '服务器错误' });
    }
});

module.exports = router;
