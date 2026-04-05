// ============================================
// PVP路由 - 匹配/战斗/排行榜
// ============================================
const express  = require('express');
const router   = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { success, fail } = require('../utils/helpers');

// GET /api/pvp/rank - 排行榜
router.get('/rank', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 50 } = req.query;
    const [rows] = await pool.query(
      `SELECT pr.rank_score, pr.rank_tier, pr.wins, pr.losses, pr.win_streak, pr.max_win_streak,
              u.username, pd.level, pd.realm_name
       FROM player_rank pr
       JOIN users u ON pr.user_id = u.id
       JOIN player_data pd ON pr.user_id = pd.user_id
       ORDER BY pr.rank_score DESC LIMIT ?`,
      [parseInt(limit)]
    );
    // 加排名序号
    rows.forEach((r, i) => { r.rank = i + 1; });
    return success(res, rows, '排行榜');
  } catch (err) { next(err); }
});

// GET /api/pvp/my - 我的PVP数据
router.get('/my', authMiddleware, async (req, res, next) => {
  try {
    const [rank] = await pool.query('SELECT * FROM player_rank WHERE user_id = ?', [req.userId]);
    if (rank.length === 0) return success(res, null, '暂无PVP数据');

    // 查最近战绩
    const [recent] = await pool.query(
      `SELECT pm.*, u1.username AS p1_name, u2.username AS p2_name
       FROM pvp_matches pm
       JOIN users u1 ON pm.player1_id = u1.id
       JOIN users u2 ON pm.player2_id = u2.id
       WHERE pm.player1_id = ? OR pm.player2_id = ?
       ORDER BY pm.created_at DESC LIMIT 10`,
      [req.userId, req.userId]
    );

    return success(res, { rank: rank[0], recentMatches: recent }, '我的PVP数据');
  } catch (err) { next(err); }
});

// POST /api/pvp/match - 匹配对手
router.post('/match', authMiddleware, async (req, res, next) => {
  try {
    const { matchType = 'ranked' } = req.body;

    const [myRank] = await pool.query('SELECT * FROM player_rank WHERE user_id = ?', [req.userId]);
    if (myRank.length === 0) return fail(res, 'PVP数据异常');
    const myScore = myRank[0].rank_score;

    // 查找分数相近的对手（±200分）
    const [opponents] = await pool.query(
      `SELECT pr.user_id, pr.rank_score, u.username, pd.level, pd.atk, pd.def, pd.hp, pd.speed
       FROM player_rank pr
       JOIN users u ON pr.user_id = u.id
       JOIN player_data pd ON pr.user_id = pd.user_id
       WHERE pr.user_id != ? AND ABS(pr.rank_score - ?) <= 200
       ORDER BY RAND() LIMIT 1`,
      [req.userId, myScore]
    );

    if (opponents.length === 0) {
      // 没有真人对手，生成机器人
      return success(res, {
        opponent: {
          username: '修仙散人',
          level: Math.max(1, Math.floor(myScore / 100)),
          isBot: true,
          atk: Math.floor(myScore / 50),
          def: Math.floor(myScore / 80),
          hp: Math.floor(myScore / 10) + 100,
        },
        matchType
      }, '匹配到对手！');
    }

    return success(res, {
      opponent: opponents[0],
      matchType
    }, `匹配到对手：${opponents[0].username}！`);
  } catch (err) { next(err); }
});

// POST /api/pvp/fight - 执行战斗
router.post('/fight', authMiddleware, async (req, res, next) => {
  try {
    const { opponentId, matchType = 'ranked' } = req.body;

    // 获取双方数据
    const [p1Data] = await pool.query(
      'SELECT user_id, level, atk, def, hp, hp_max, speed, luck FROM player_data WHERE user_id = ?',
      [req.userId]
    );
    if (p1Data.length === 0) return fail(res, '玩家数据异常');

    let p2Data;
    let isBot = false;

    if (opponentId) {
      const [p2] = await pool.query(
        'SELECT user_id, level, atk, def, hp, hp_max, speed, luck FROM player_data WHERE user_id = ?',
        [opponentId]
      );
      if (p2.length === 0) return fail(res, '对手不存在');
      p2Data = p2[0];
    } else {
      // 机器人对手
      isBot = true;
      const [myRank] = await pool.query('SELECT rank_score FROM player_rank WHERE user_id = ?', [req.userId]);
      const score = myRank[0]?.rank_score || 1000;
      p2Data = {
        user_id: 0, level: Math.max(1, Math.floor(score / 100)),
        atk: Math.floor(score / 50), def: Math.floor(score / 80),
        hp: Math.floor(score / 10) + 100, hp_max: Math.floor(score / 10) + 100,
        speed: Math.floor(score / 100), luck: 5
      };
    }

    // 简化战斗模拟
    const p1 = { ...p1Data[0] };
    const p2 = { ...p2Data };
    let p1Hp = p1.hp_max, p2Hp = p2.hp_max;
    let rounds = 0;
    const maxRounds = 20;
    let p1TotalDmg = 0, p2TotalDmg = 0;

    while (p1Hp > 0 && p2Hp > 0 && rounds < maxRounds) {
      rounds++;
      // 先手判定
      const p1First = p1.speed + Math.random() * 10 >= p2.speed + Math.random() * 10;

      const calcDmg = (atk, def, luck) => {
        const base = Math.max(1, atk - def * 0.5);
        const crit = Math.random() < luck * 0.02 ? 1.5 : 1;
        return Math.floor(base * (0.8 + Math.random() * 0.4) * crit);
      };

      if (p1First) {
        const d1 = calcDmg(p1.atk, p2.def, p1.luck); p2Hp -= d1; p1TotalDmg += d1;
        if (p2Hp > 0) { const d2 = calcDmg(p2.atk, p1.def, p2.luck); p1Hp -= d2; p2TotalDmg += d2; }
      } else {
        const d2 = calcDmg(p2.atk, p1.def, p2.luck); p1Hp -= d2; p2TotalDmg += d2;
        if (p1Hp > 0) { const d1 = calcDmg(p1.atk, p2.def, p1.luck); p2Hp -= d1; p1TotalDmg += d1; }
      }
    }

    const p1Win = p1Hp > p2Hp;
    const winnerId = p1Win ? req.userId : (isBot ? 0 : p2.user_id);

    // 排名分变化
    const scoreChange = p1Win ? 25 : -20;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 记录比赛
      if (!isBot) {
        await conn.query(
          `INSERT INTO pvp_matches (player1_id, player2_id, winner_id, match_type, player1_damage, player2_damage, rounds)
           VALUES (?,?,?,?,?,?,?)`,
          [req.userId, p2.user_id, winnerId, matchType, p1TotalDmg, p2TotalDmg, rounds]
        );
      }

      // 更新排名
      if (matchType === 'ranked') {
        if (p1Win) {
          await conn.query(
            `UPDATE player_rank SET rank_score = rank_score + ?, wins = wins + 1,
             win_streak = win_streak + 1, max_win_streak = GREATEST(max_win_streak, win_streak + 1)
             WHERE user_id = ?`,
            [scoreChange, req.userId]
          );
        } else {
          await conn.query(
            `UPDATE player_rank SET rank_score = GREATEST(0, rank_score + ?), losses = losses + 1, win_streak = 0
             WHERE user_id = ?`,
            [scoreChange, req.userId]
          );
        }
        // 更新段位
        const [newRank] = await conn.query('SELECT rank_score FROM player_rank WHERE user_id = ?', [req.userId]);
        const score = newRank[0].rank_score;
        let tier = 'bronze';
        if (score >= 2000) tier = 'legend';
        else if (score >= 1600) tier = 'diamond';
        else if (score >= 1300) tier = 'gold';
        else if (score >= 1100) tier = 'silver';
        await conn.query('UPDATE player_rank SET rank_tier = ? WHERE user_id = ?', [tier, req.userId]);
      }

      // 战斗奖励
      const reward = p1Win ? Math.floor(p1.level * 50 + Math.random() * 200) : Math.floor(p1.level * 10);
      await conn.query('UPDATE player_data SET gold = gold + ? WHERE user_id = ?', [reward, req.userId]);

      await conn.commit();

      return success(res, {
        victory: p1Win,
        rounds,
        p1Damage: p1TotalDmg,
        p2Damage: p2TotalDmg,
        p1HpRemain: Math.max(0, p1Hp),
        p2HpRemain: Math.max(0, p2Hp),
        scoreChange,
        goldReward: reward,
        isBot,
      }, p1Win ? '🎉 战斗胜利！' : '💀 战斗失败...');
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
