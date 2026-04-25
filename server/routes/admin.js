const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// 获取任务列表（后台管理）
router.get('/quests', adminMiddleware, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const type = req.query.type;
        const search = req.query.search;
        
        let sql = 'SELECT q.*, t.name as title_name FROM quests q LEFT JOIN titles t ON q.title_id = t.id WHERE 1=1';
        let countSql = 'SELECT COUNT(*) as total FROM quests WHERE 1=1';
        const params = [];
        
        if (type) {
            sql += ' AND q.type = ?';
            countSql += ' AND type = ?';
            params.push(type);
        }
        
        if (search) {
            sql += ' AND (q.id LIKE ? OR q.name LIKE ?)';
            countSql += ' AND (id LIKE ? OR name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        sql += ' ORDER BY q.type, q.sort_order LIMIT ? OFFSET ?';
        params.push(limit, offset);
        
        const [rows] = await pool.query(sql, params);
        const [countResult] = await pool.query(countSql, params.slice(0, type || search ? (type ? 1 : 2) : 0));
        const total = countResult[0].total;
        
        // 获取每个任务的完成人数
        const questIds = rows.map(r => r.id);
        let completionStats = {};
        if (questIds.length > 0) {
            const [stats] = await pool.query(
                'SELECT quest_id, COUNT(*) as count FROM player_quest_progress WHERE claimed = 1 AND quest_id IN (?) GROUP BY quest_id',
                [questIds]
            );
            stats.forEach(s => {
                completionStats[s.quest_id] = s.count;
            });
        }
        
        const result = rows.map(q => ({
            ...q,
            completion_count: completionStats[q.id] || 0
        }));
        
        res.json({
            code: 200,
            data: {
                quests: result,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch(e) {
        next(e);
    }
});

// 创建/更新任务
router.post('/quests', adminMiddleware, async (req, res, next) => {
    try {
        const {
            id, title_id, type, name, description, target_type, target_count,
            reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle,
            reward_gold_paper, reward_fruit, reward_yuanbao, unlock_level, sort_order
        } = req.body;
        
        if (!id || !name || !type || !target_type) {
            return res.json({ code: 400, message: '缺少必要字段' });
        }
        
        // 检查是否存在
        const [existing] = await pool.query('SELECT id FROM quests WHERE id = ?', [id]);
        
        if (existing.length) {
            // 更新
            await pool.query(`
                UPDATE quests SET 
                    title_id = ?, type = ?, name = ?, description = ?, target_type = ?,
                    target_count = ?, reward_gold = ?, reward_merit = ?, reward_fragment = ?,
                    reward_incense = ?, reward_candle = ?, reward_gold_paper = ?, reward_fruit = ?,
                    reward_yuanbao = ?, unlock_level = ?, sort_order = ?
                WHERE id = ?
            `, [title_id, type, name, description, target_type, target_count || 1,
                reward_gold || 0, reward_merit || 0, reward_fragment || 0,
                reward_incense || 0, reward_candle || 0, reward_gold_paper || 0, reward_fruit || 0,
                reward_yuanbao || 0, unlock_level || 1, sort_order || 0, id]);
            
            res.json({ code: 200, message: '任务更新成功' });
        } else {
            // 创建
            await pool.query(`
                INSERT INTO quests (id, title_id, type, name, description, target_type, target_count,
                    reward_gold, reward_merit, reward_fragment, reward_incense, reward_candle,
                    reward_gold_paper, reward_fruit, reward_yuanbao, unlock_level, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, title_id, type, name, description, target_type, target_count || 1,
                reward_gold || 0, reward_merit || 0, reward_fragment || 0,
                reward_incense || 0, reward_candle || 0, reward_gold_paper || 0, reward_fruit || 0,
                reward_yuanbao || 0, unlock_level || 1, sort_order || 0]);
            
            res.json({ code: 200, message: '任务创建成功' });
        }
    } catch(e) {
        next(e);
    }
});

// 删除任务
router.delete('/quests/:id', adminMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE quests SET is_active = 0 WHERE id = ?', [id]);
        res.json({ code: 200, message: '任务已停用' });
    } catch(e) {
        next(e);
    }
});

// 获取称号列表（后台管理）
router.get('/titles', adminMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM titles ORDER BY sort_order');
        
        // 获取每个称号的解锁人数
        const [stats] = await pool.query(
            'SELECT title_id, COUNT(*) as count FROM player_titles WHERE unlocked_at IS NOT NULL GROUP BY title_id'
        );
        
        const statsMap = {};
        stats.forEach(s => {
            statsMap[s.title_id] = s.count;
        });
        
        const result = rows.map(t => ({
            ...t,
            unlock_count: statsMap[t.id] || 0
        }));
        
        res.json({ code: 200, data: result });
    } catch(e) {
        next(e);
    }
});

// 创建/更新称号
router.post('/titles', adminMiddleware, async (req, res, next) => {
    try {
        const { id, name, desc, bonus, icon, sort_order } = req.body;
        
        if (!id || !name || !desc || !bonus) {
            return res.json({ code: 400, message: '缺少必要字段' });
        }
        
        const [existing] = await pool.query('SELECT id FROM titles WHERE id = ?', [id]);
        
        if (existing.length) {
            await pool.query(
                'UPDATE titles SET name = ?, `desc` = ?, bonus = ?, icon = ?, sort_order = ? WHERE id = ?',
                [name, desc, bonus, icon || '🏆', sort_order || 0, id]
            );
            res.json({ code: 200, message: '称号更新成功' });
        } else {
            await pool.query(
                'INSERT INTO titles (id, name, `desc`, bonus, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
                [id, name, desc, bonus, icon || '🏆', sort_order || 0]
            );
            res.json({ code: 200, message: '称号创建成功' });
        }
    } catch(e) {
        next(e);
    }
});

// 删除称号
router.delete('/titles/:id', adminMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE titles SET is_active = 0 WHERE id = ?', [id]);
        res.json({ code: 200, message: '称号已停用' });
    } catch(e) {
        next(e);
    }
});

// 重置玩家任务进度
router.post('/quests/:playerId/reset', adminMiddleware, async (req, res, next) => {
    try {
        const { playerId } = req.params;
        const { quest_id } = req.body;
        
        if (quest_id) {
            await pool.query(
                'DELETE FROM player_quest_progress WHERE player_id = ? AND quest_id = ?',
                [playerId, quest_id]
            );
            res.json({ code: 200, message: '玩家任务进度已重置' });
        } else {
            await pool.query(
                'DELETE FROM player_quest_progress WHERE player_id = ?',
                [playerId]
            );
            res.json({ code: 200, message: '玩家所有任务进度已重置' });
        }
    } catch(e) {
        next(e);
    }
});

// GET /api/admin/users - 获取用户列表
router.get('/users', adminMiddleware, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        const [users] = await pool.query(
            `SELECT u.id, u.username, u.status, u.created_at,
                    p.player_id, p.nickname, p.level, p.realm_name, p.gold, p.yuanbao
             FROM users u
             LEFT JOIN player_data p ON u.id = p.user_id
             ORDER BY u.id DESC
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );
        
        const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM users');
        
        res.json({
            code: 200,
            data: {
                users,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (e) {
        console.error('Get users error:', e);
        res.json({ code: 500, message: '获取用户列表失败' });
    }
});

// GET /api/admin/users/:id - 获取单个用户详情
router.get('/users/:id', adminMiddleware, async (req, res, next) => {
    try {
        const userId = parseInt(req.params.id);
        const [users] = await pool.query(
            `SELECT u.id, u.username, u.status, u.created_at, u.last_login_at, u.ban_reason,
                    p.player_id, p.nickname, p.level, p.exp, p.realm, p.realm_name,
                    p.gold, p.yuanbao, p.merit, p.faith, p.reputation,
                    p.daily_alms, p.daily_sign, p.sign_streak, p.total_sign,
                    p.alms_count, p.great_count, p.alms_miss_streak, p.worship_count,
                    p.invitation_code, p.invited_by,
                    p.mana, p.fragments, p.online_seconds,
                    p.banners, p.gold_paper, p.fruits, p.incense_sticks, p.candles,
                    p.hp, p.hp_max, p.mp, p.mp_max, p.atk, p.def, p.speed, p.luck, p.charm
             FROM users u
             LEFT JOIN player_data p ON u.id = p.user_id
             WHERE u.id = ?`,
            [userId]
        );
        
        if (users.length === 0) {
            return res.json({ code: 404, message: '用户不存在' });
        }
        
        res.json({ code: 200, data: users[0] });
    } catch (e) {
        console.error('Get user error:', e);
        res.json({ code: 500, message: '获取用户详情失败' });
    }
});

// POST /api/admin/users/:id/update - 更新用户数据
router.post('/users/:id/update', adminMiddleware, async (req, res, next) => {
    try {
        const userId = parseInt(req.params.id);
        const {
            // users table fields
            status, ban_reason,
            // player_data fields
            nickname, level, exp, realm, realm_name,
            gold, yuanbao, merit, faith, reputation,
            daily_alms, daily_sign, sign_streak,
            alms_count, great_count, alms_miss_streak, worship_count,
            mana, fragments, banners, gold_paper, fruits,
            hp, hp_max, mp, mp_max, atk, def, speed, luck, charm
        } = req.body;
        
        // Update users table
        if (status !== undefined || ban_reason !== undefined) {
            const userFields = [];
            const userValues = [];
            if (status !== undefined) { userFields.push('status = ?'); userValues.push(status); }
            if (ban_reason !== undefined) { userFields.push('ban_reason = ?'); userValues.push(ban_reason); }
            if (userFields.length > 0) {
                userValues.push(userId);
                await pool.query(`UPDATE users SET ${userFields.join(', ')} WHERE id = ?`, userValues);
            }
        }
        
        // Update player_data table
        const playerFields = [];
        const playerValues = [];
        if (nickname !== undefined) { playerFields.push('nickname = ?'); playerValues.push(nickname); }
        if (level !== undefined) { playerFields.push('level = ?'); playerValues.push(level); }
        if (exp !== undefined) { playerFields.push('exp = ?'); playerValues.push(exp); }
        if (realm !== undefined) { playerFields.push('realm = ?'); playerValues.push(realm); }
        if (realm_name !== undefined) { playerFields.push('realm_name = ?'); playerValues.push(realm_name); }
        if (gold !== undefined) { playerFields.push('gold = ?'); playerValues.push(gold); }
        if (yuanbao !== undefined) { playerFields.push('yuanbao = ?'); playerValues.push(yuanbao); }
        if (merit !== undefined) { playerFields.push('merit = ?'); playerValues.push(merit); }
        if (faith !== undefined) { playerFields.push('faith = ?'); playerValues.push(faith); }
        if (reputation !== undefined) { playerFields.push('reputation = ?'); playerValues.push(reputation); }
        if (daily_alms !== undefined) { playerFields.push('daily_alms = ?'); playerValues.push(daily_alms); }
        if (daily_sign !== undefined) { playerFields.push('daily_sign = ?'); playerValues.push(daily_sign); }
        if (sign_streak !== undefined) { playerFields.push('sign_streak = ?'); playerValues.push(sign_streak); }
        if (alms_count !== undefined) { playerFields.push('alms_count = ?'); playerValues.push(alms_count); }
        if (great_count !== undefined) { playerFields.push('great_count = ?'); playerValues.push(great_count); }
        if (alms_miss_streak !== undefined) { playerFields.push('alms_miss_streak = ?'); playerValues.push(alms_miss_streak); }
        if (worship_count !== undefined) { playerFields.push('worship_count = ?'); playerValues.push(worship_count); }
        if (mana !== undefined) { playerFields.push('mana = ?'); playerValues.push(mana); }
        if (fragments !== undefined) { playerFields.push('fragments = ?'); playerValues.push(fragments); }
        if (banners !== undefined) { playerFields.push('banners = ?'); playerValues.push(banners); }
        if (gold_paper !== undefined) { playerFields.push('gold_paper = ?'); playerValues.push(gold_paper); }
        if (fruits !== undefined) { playerFields.push('fruits = ?'); playerValues.push(fruits); }
        if (hp !== undefined) { playerFields.push('hp = ?'); playerValues.push(hp); }
        if (hp_max !== undefined) { playerFields.push('hp_max = ?'); playerValues.push(hp_max); }
        if (mp !== undefined) { playerFields.push('mp = ?'); playerValues.push(mp); }
        if (mp_max !== undefined) { playerFields.push('mp_max = ?'); playerValues.push(mp_max); }
        if (atk !== undefined) { playerFields.push('atk = ?'); playerValues.push(atk); }
        if (def !== undefined) { playerFields.push('def = ?'); playerValues.push(def); }
        if (speed !== undefined) { playerFields.push('speed = ?'); playerValues.push(speed); }
        if (luck !== undefined) { playerFields.push('luck = ?'); playerValues.push(luck); }
        if (charm !== undefined) { playerFields.push('charm = ?'); playerValues.push(charm); }
        
        if (playerFields.length > 0) {
            playerValues.push(userId);
            await pool.query(`UPDATE player_data SET ${playerFields.join(', ')} WHERE user_id = ?`, playerValues);
        }
        
        res.json({ code: 200, message: '更新成功' });
    } catch (e) {
        console.error('Update user error:', e);
        res.json({ code: 500, message: '更新失败' });
    }
});

// POST /api/admin/users/:id/alms-override - 更新用户化缘概率覆盖
router.post('/users/:id/alms-override', adminMiddleware, async (req, res, next) => {
    try {
        const userId = parseInt(req.params.id);
        const override = req.body; // 接收完整的覆盖配置
        
        // 如果 override 为空或空对象，清除覆盖
        if (!override || Object.keys(override).length === 0) {
            await pool.query('UPDATE player_data SET alms_override = NULL WHERE user_id = ?', [userId]);
        } else {
            await pool.query('UPDATE player_data SET alms_override = ? WHERE user_id = ?', 
                [JSON.stringify(override), userId]);
        }
        
        res.json({ code: 200, message: '化缘概率覆盖已更新' });
    } catch (e) {
        console.error('Update alms override error:', e);
        res.json({ code: 500, message: '更新失败' });
    }
});

// POST /api/admin/users/:id/ban - 封禁用户
router.post('/users/:id/ban', adminMiddleware, async (req, res, next) => {
    try {
        const userId = parseInt(req.params.id);
        const { reason } = req.body;
        
        await pool.query('UPDATE users SET status = 0 WHERE id = ?', [userId]);
        await pool.query(
            'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
            [userId, 'admin_ban', JSON.stringify({ reason: reason || '管理员封禁' })]
        );
        
        res.json({ code: 200, message: '封禁成功' });
    } catch (e) {
        console.error('Ban user error:', e);
        res.json({ code: 500, message: '封禁失败' });
    }
});

// POST /api/admin/users/:id/unban - 解封用户
router.post('/users/:id/unban', adminMiddleware, async (req, res, next) => {
    try {
        const userId = parseInt(req.params.id);
        
        await pool.query('UPDATE users SET status = 1 WHERE id = ?', [userId]);
        await pool.query(
            'INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)',
            [userId, 'admin_unban', JSON.stringify({ action: '管理员解封' })]
        );
        
        res.json({ code: 200, message: '解封成功' });
    } catch (e) {
        console.error('Unban user error:', e);
        res.json({ code: 500, message: '解封失败' });
    }
});

// GET /api/admin/dashboard - 获取仪表盘数据
router.get('/dashboard', adminMiddleware, async (req, res, next) => {
    try {
        const [[{ totalUsers }]] = await pool.query('SELECT COUNT(*) as totalUsers FROM users');
        const [[{ activeToday }]] = await pool.query('SELECT COUNT(*) as activeToday FROM users WHERE DATE(last_login_at) = CURDATE()');
        const [[{ totalGold }]] = await pool.query('SELECT SUM(gold) as totalGold FROM player_data');
        const [[{ totalPlayers }]] = await pool.query('SELECT COUNT(*) as totalPlayers FROM player_data');
        
        res.json({
            code: 200,
            data: {
                users: { total: totalUsers, activeToday: activeToday || 0 },
                revenue: { todayCNY: 0 },
                gold: totalGold || 0,
                players: totalPlayers || 0
            }
        });
    } catch (e) {
        console.error('Dashboard error:', e);
        res.json({ code: 500, message: '获取仪表盘数据失败' });
    }
});

// GET /api/admin/alms-config - 获取化缘配置
router.get('/alms-config', adminMiddleware, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT config_value FROM game_config WHERE config_name = ?', ['alms_config']);
        if (rows.length === 0) {
            return res.json({ code: 200, data: {} });
        }
        res.json({ code: 200, data: rows[0].config_value });
    } catch (e) {
        console.error('Get alms-config error:', e);
        res.json({ code: 500, message: '获取化缘配置失败' });
    }
});

// POST /api/admin/alms-config - 保存化缘配置
router.post('/alms-config', adminMiddleware, async (req, res, next) => {
    try {
        await pool.query(
            'INSERT INTO game_config (config_name, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)',
            ['alms_config', JSON.stringify(req.body)]
        );
        res.json({ code: 200, message: '保存成功' });
    } catch (e) {
        console.error('Save alms-config error:', e);
        res.json({ code: 500, message: '保存化缘配置失败' });
    }
});

module.exports = router;
