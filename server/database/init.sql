-- ============================================
-- 财神大陆 - 数据库初始化脚本
-- 24张核心表 + 索引
-- 执行: mysql -u root -p < init.sql
-- ============================================

CREATE DATABASE IF NOT EXISTS caishen_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE caishen_db;

-- ==================== 1. 用户与玩家 ====================

-- 用户账号表
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id       INT UNSIGNED NOT NULL UNIQUE COMMENT '7位玩家ID',
  username        VARCHAR(32)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  email           VARCHAR(128) DEFAULT NULL,
  phone           VARCHAR(20)  DEFAULT NULL,
  avatar          VARCHAR(255) DEFAULT NULL,
  status          TINYINT      NOT NULL DEFAULT 1 COMMENT '1正常 0封禁',
  ban_reason      VARCHAR(255) DEFAULT NULL,
  last_login_at   DATETIME     DEFAULT NULL,
  last_login_ip   VARCHAR(45)  DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_player_id (player_id)
) ENGINE=InnoDB;

-- 玩家数据表 (核心属性)
CREATE TABLE IF NOT EXISTS player_data (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL UNIQUE,
  player_id       INT UNSIGNED NOT NULL UNIQUE COMMENT '7位玩家ID',
  nickname        VARCHAR(32)  NOT NULL DEFAULT '无名散修',
  level           INT          NOT NULL DEFAULT 1,
  exp             BIGINT       NOT NULL DEFAULT 0,
  realm           TINYINT      NOT NULL DEFAULT 1 COMMENT '境界 1-6',
  realm_name      VARCHAR(20)  NOT NULL DEFAULT '凡人',
  gold            BIGINT       NOT NULL DEFAULT 0,
  yuanbao         BIGINT       NOT NULL DEFAULT 0 COMMENT '元宝(充值货币)',
  hp              INT          NOT NULL DEFAULT 100,
  hp_max          INT          NOT NULL DEFAULT 100,
  mp              INT          NOT NULL DEFAULT 50,
  mp_max          INT          NOT NULL DEFAULT 50,
  atk             INT          NOT NULL DEFAULT 10,
  def             INT          NOT NULL DEFAULT 5,
  speed           INT          NOT NULL DEFAULT 10,
  luck            INT          NOT NULL DEFAULT 5,
  charm           INT          NOT NULL DEFAULT 5,
  daily_alms      INT          NOT NULL DEFAULT 20 COMMENT '今日剩余化缘次数',
  daily_sign      TINYINT      NOT NULL DEFAULT 0 COMMENT '今日是否签到',
  sign_streak     INT          NOT NULL DEFAULT 0 COMMENT '连续签到天数',
  total_sign      INT          NOT NULL DEFAULT 0,
  alms_miss_streak INT         NOT NULL DEFAULT 0 COMMENT '化缘连亏次数(保底)',
  temple_storage  BIGINT       NOT NULL DEFAULT 5000,
  merit          INT          NOT NULL DEFAULT 0 COMMENT '功德',
  faith          INT          NOT NULL DEFAULT 0 COMMENT '信仰',
  reputation     INT          NOT NULL DEFAULT 0 COMMENT '声望',
  mana          INT          NOT NULL DEFAULT 100 COMMENT '灵力',
  fragments     INT          NOT NULL DEFAULT 0 COMMENT '碎片',
  banners       INT          NOT NULL DEFAULT 0 COMMENT '幡旗',
  gold_paper    INT          NOT NULL DEFAULT 0 COMMENT '金纸',
  fruits        INT          NOT NULL DEFAULT 0 COMMENT '供果',
  incense_sticks INT         NOT NULL DEFAULT 3 COMMENT '线香',
  candles       INT          NOT NULL DEFAULT 1 COMMENT '蜡烛',
  incense_type    VARCHAR(20)  DEFAULT NULL COMMENT '当前点香类型',
  incense_end_at  DATETIME     DEFAULT NULL,
  online_seconds  BIGINT       NOT NULL DEFAULT 0,
  last_daily_reset DATE        DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_level (level),
  INDEX idx_realm (realm),
  INDEX idx_gold (gold)
) ENGINE=InnoDB;

-- ==================== 2. 物品系统 ====================

-- 物品定义表 (配置表)
CREATE TABLE IF NOT EXISTS items (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(64)  NOT NULL,
  type            VARCHAR(20)  NOT NULL COMMENT 'consumable/material/equipment/treasure/gift',
  sub_type        VARCHAR(20)  DEFAULT NULL,
  rarity          TINYINT      NOT NULL DEFAULT 1 COMMENT '1白 2绿 3蓝 4紫 5橙 6红',
  description     TEXT,
  icon            VARCHAR(255) DEFAULT NULL,
  stackable       TINYINT      NOT NULL DEFAULT 1,
  max_stack       INT          NOT NULL DEFAULT 99,
  sell_price      INT          NOT NULL DEFAULT 0,
  buy_price       INT          NOT NULL DEFAULT 0,
  use_effect      JSON         DEFAULT NULL COMMENT '使用效果JSON',
  equip_slot      VARCHAR(20)  DEFAULT NULL COMMENT '装备槽位',
  equip_stats     JSON         DEFAULT NULL COMMENT '装备属性JSON',
  level_req       INT          NOT NULL DEFAULT 1,
  realm_req       TINYINT      NOT NULL DEFAULT 1,
  tradeable       TINYINT      NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type (type),
  INDEX idx_rarity (rarity)
) ENGINE=InnoDB;

-- 玩家背包表
CREATE TABLE IF NOT EXISTS inventory (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  item_id         INT UNSIGNED    NOT NULL,
  quantity        INT          NOT NULL DEFAULT 1,
  slot            INT          NOT NULL DEFAULT 0 COMMENT '背包格子位置',
  is_locked       TINYINT      NOT NULL DEFAULT 0,
  obtained_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id),
  INDEX idx_user (user_id),
  UNIQUE KEY uk_user_slot (user_id, slot)
) ENGINE=InnoDB;

-- ==================== 3. 装备系统 ====================

CREATE TABLE IF NOT EXISTS equipment (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  slot            VARCHAR(20)  NOT NULL COMMENT 'weapon/armor/helm/boots/ring/amulet',
  item_id         INT UNSIGNED    DEFAULT NULL,
  enhance_level   INT          NOT NULL DEFAULT 0,
  enchant         JSON         DEFAULT NULL COMMENT '附魔属性',
  gems            JSON         DEFAULT NULL COMMENT '镶嵌宝石',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_slot (user_id, slot)
) ENGINE=InnoDB;

-- ==================== 4. 厢房(仓库)系统 ====================

CREATE TABLE IF NOT EXISTS side_room (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  item_id         INT UNSIGNED    NOT NULL,
  quantity        INT          NOT NULL DEFAULT 1,
  slot            INT          NOT NULL DEFAULT 0,
  stored_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id),
  INDEX idx_user (user_id),
  UNIQUE KEY uk_user_slot (user_id, slot)
) ENGINE=InnoDB;

-- ==================== 5. 技能系统 ====================

-- 技能定义表
CREATE TABLE IF NOT EXISTS skills (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(64)  NOT NULL,
  type            VARCHAR(20)  NOT NULL COMMENT 'active/passive/ultimate',
  element         VARCHAR(20)  DEFAULT NULL COMMENT 'fire/water/earth/wind/thunder/holy/dark',
  description     TEXT,
  icon            VARCHAR(255) DEFAULT NULL,
  max_level       INT          NOT NULL DEFAULT 10,
  base_damage     INT          NOT NULL DEFAULT 0,
  mp_cost         INT          NOT NULL DEFAULT 0,
  cooldown_sec    INT          NOT NULL DEFAULT 0,
  level_req       INT          NOT NULL DEFAULT 1,
  realm_req       TINYINT      NOT NULL DEFAULT 1,
  effect          JSON         DEFAULT NULL COMMENT '技能效果JSON',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_type (type)
) ENGINE=InnoDB;

-- 玩家已学技能
CREATE TABLE IF NOT EXISTS player_skills (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  skill_id        INT UNSIGNED    NOT NULL,
  level           INT          NOT NULL DEFAULT 1,
  equipped        TINYINT      NOT NULL DEFAULT 0,
  slot            INT          DEFAULT NULL COMMENT '技能栏位置',
  learned_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id),
  UNIQUE KEY uk_user_skill (user_id, skill_id)
) ENGINE=InnoDB;

-- ==================== 6. 门派系统 ====================

CREATE TABLE IF NOT EXISTS sects (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(32)  NOT NULL UNIQUE,
  leader_id       BIGINT UNSIGNED DEFAULT NULL,
  description     TEXT,
  level           INT          NOT NULL DEFAULT 1,
  exp             BIGINT       NOT NULL DEFAULT 0,
  funds           BIGINT       NOT NULL DEFAULT 0,
  max_members     INT          NOT NULL DEFAULT 50,
  member_count    INT          NOT NULL DEFAULT 0,
  announcement    TEXT         DEFAULT NULL,
  icon            VARCHAR(255) DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_level (level)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_sect (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL UNIQUE,
  sect_id         INT UNSIGNED    NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'member' COMMENT 'leader/elder/member',
  contribution    BIGINT       NOT NULL DEFAULT 0,
  joined_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sect_id) REFERENCES sects(id) ON DELETE CASCADE,
  INDEX idx_sect (sect_id)
) ENGINE=InnoDB;

-- ==================== 7. 师徒系统 ====================

CREATE TABLE IF NOT EXISTS mentor_relationships (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mentor_id       BIGINT UNSIGNED NOT NULL,
  apprentice_id   BIGINT UNSIGNED NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active' COMMENT 'active/graduated/dissolved',
  mentor_reward   BIGINT       NOT NULL DEFAULT 0,
  apprentice_bonus BIGINT      NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  graduated_at    DATETIME     DEFAULT NULL,
  FOREIGN KEY (mentor_id) REFERENCES users(id),
  FOREIGN KEY (apprentice_id) REFERENCES users(id),
  UNIQUE KEY uk_mentor_apprentice (mentor_id, apprentice_id),
  INDEX idx_mentor (mentor_id),
  INDEX idx_apprentice (apprentice_id)
) ENGINE=InnoDB;

-- ==================== 8. 宠物/灵兽系统 ====================

CREATE TABLE IF NOT EXISTS pets (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  pet_type        VARCHAR(32)  NOT NULL COMMENT '灵兽种类',
  name            VARCHAR(32)  NOT NULL,
  level           INT          NOT NULL DEFAULT 1,
  exp             BIGINT       NOT NULL DEFAULT 0,
  quality         TINYINT      NOT NULL DEFAULT 1 COMMENT '1白 2绿 3蓝 4紫 5橙',
  hp              INT          NOT NULL DEFAULT 50,
  atk             INT          NOT NULL DEFAULT 5,
  def             INT          NOT NULL DEFAULT 3,
  skill_1         VARCHAR(64)  DEFAULT NULL,
  skill_2         VARCHAR(64)  DEFAULT NULL,
  is_active       TINYINT      NOT NULL DEFAULT 0 COMMENT '是否出战',
  intimacy        INT          NOT NULL DEFAULT 0 COMMENT '亲密度',
  obtained_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_active (user_id, is_active)
) ENGINE=InnoDB;

-- ==================== 9. 坐骑系统 ====================

CREATE TABLE IF NOT EXISTS mounts (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  mount_type      VARCHAR(32)  NOT NULL COMMENT '坐骑种类',
  name            VARCHAR(32)  NOT NULL,
  level           INT          NOT NULL DEFAULT 1,
  speed_bonus     INT          NOT NULL DEFAULT 10,
  is_active       TINYINT      NOT NULL DEFAULT 0,
  obtained_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id)
) ENGINE=InnoDB;

-- ==================== 10. 精怪契约系统 ====================

CREATE TABLE IF NOT EXISTS spirit_contracts (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  spirit_type     VARCHAR(32)  NOT NULL,
  spirit_name     VARCHAR(32)  NOT NULL,
  level           INT          NOT NULL DEFAULT 1,
  bond            INT          NOT NULL DEFAULT 0 COMMENT '羁绊值',
  skill           VARCHAR(64)  DEFAULT NULL,
  is_active       TINYINT      NOT NULL DEFAULT 0,
  contracted_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id)
) ENGINE=InnoDB;

-- ==================== 11. PVP系统 ====================

CREATE TABLE IF NOT EXISTS pvp_matches (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player1_id      BIGINT UNSIGNED NOT NULL,
  player2_id      BIGINT UNSIGNED NOT NULL,
  winner_id       BIGINT UNSIGNED DEFAULT NULL,
  match_type      VARCHAR(20)  NOT NULL DEFAULT 'ranked' COMMENT 'ranked/casual/tournament',
  player1_damage  INT          NOT NULL DEFAULT 0,
  player2_damage  INT          NOT NULL DEFAULT 0,
  rounds          INT          NOT NULL DEFAULT 0,
  replay_data     JSON         DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player1_id) REFERENCES users(id),
  FOREIGN KEY (player2_id) REFERENCES users(id),
  INDEX idx_player1 (player1_id),
  INDEX idx_player2 (player2_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_rank (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL UNIQUE,
  rank_score      INT          NOT NULL DEFAULT 1000,
  rank_tier       VARCHAR(20)  NOT NULL DEFAULT 'bronze' COMMENT 'bronze/silver/gold/diamond/legend',
  wins            INT          NOT NULL DEFAULT 0,
  losses          INT          NOT NULL DEFAULT 0,
  win_streak      INT          NOT NULL DEFAULT 0,
  max_win_streak  INT          NOT NULL DEFAULT 0,
  season          INT          NOT NULL DEFAULT 1,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_score (rank_score DESC)
) ENGINE=InnoDB;

-- ==================== 12. 交易市场 ====================

CREATE TABLE IF NOT EXISTS stalls (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  stall_name      VARCHAR(32)  DEFAULT '无名摊位',
  stall_level     INT          NOT NULL DEFAULT 1,
  max_items       INT          NOT NULL DEFAULT 5,
  is_open         TINYINT      NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stall_items (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  stall_id        BIGINT UNSIGNED NOT NULL,
  seller_id       BIGINT UNSIGNED NOT NULL,
  item_id         INT UNSIGNED    NOT NULL,
  quantity        INT          NOT NULL DEFAULT 1,
  price           BIGINT       NOT NULL,
  buyer_id        BIGINT UNSIGNED DEFAULT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'selling' COMMENT 'selling/sold/cancelled',
  listed_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sold_at         DATETIME     DEFAULT NULL,
  FOREIGN KEY (stall_id) REFERENCES stalls(id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id) REFERENCES users(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  INDEX idx_stall (stall_id),
  INDEX idx_seller (seller_id),
  INDEX idx_item_status (item_id, status),
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- ==================== 13. 充值系统 ====================

CREATE TABLE IF NOT EXISTS recharge_orders (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_no        VARCHAR(64)  NOT NULL UNIQUE,
  user_id         BIGINT UNSIGNED NOT NULL,
  amount_cny      DECIMAL(10,2) NOT NULL,
  yuanbao_amount  INT          NOT NULL,
  bonus_yuanbao   INT          NOT NULL DEFAULT 0,
  channel         VARCHAR(20)  NOT NULL DEFAULT 'wechat' COMMENT 'wechat/alipay/apple',
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending' COMMENT 'pending/paid/failed/refunded',
  trade_no        VARCHAR(128) DEFAULT NULL COMMENT '第三方交易号',
  paid_at         DATETIME     DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user (user_id),
  INDEX idx_order_no (order_no),
  INDEX idx_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_vip (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL UNIQUE,
  vip_level       INT          NOT NULL DEFAULT 0,
  total_recharge  DECIMAL(12,2) NOT NULL DEFAULT 0,
  monthly_card    TINYINT      NOT NULL DEFAULT 0,
  monthly_card_end DATE        DEFAULT NULL,
  first_recharge  TINYINT      NOT NULL DEFAULT 0,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ==================== 14. 活动系统 ====================

CREATE TABLE IF NOT EXISTS events (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(64)  NOT NULL,
  type            VARCHAR(20)  NOT NULL COMMENT 'login/recharge/rank/limited/festival',
  description     TEXT,
  config          JSON         NOT NULL COMMENT '活动配置JSON',
  rewards         JSON         DEFAULT NULL,
  start_at        DATETIME     NOT NULL,
  end_at          DATETIME     NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'upcoming' COMMENT 'upcoming/active/ended',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status_time (status, start_at, end_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_event_progress (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  event_id        INT UNSIGNED    NOT NULL,
  progress        JSON         DEFAULT NULL,
  rewards_claimed JSON         DEFAULT NULL,
  completed       TINYINT      NOT NULL DEFAULT 0,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_event (user_id, event_id)
) ENGINE=InnoDB;

-- ==================== 15. 日志与安全 ====================

CREATE TABLE IF NOT EXISTS logs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED DEFAULT NULL,
  action          VARCHAR(64)  NOT NULL,
  detail          JSON         DEFAULT NULL,
  ip              VARCHAR(45)  DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_action (action),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cheat_detection (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NOT NULL,
  type            VARCHAR(32)  NOT NULL COMMENT 'speed_hack/gold_hack/dupe/tamper',
  severity        TINYINT      NOT NULL DEFAULT 1 COMMENT '1低 2中 3高',
  evidence        JSON         DEFAULT NULL,
  action_taken    VARCHAR(20)  DEFAULT NULL COMMENT 'warn/mute/ban/none',
  resolved        TINYINT      NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user (user_id),
  INDEX idx_type (type),
  INDEX idx_severity (severity)
) ENGINE=InnoDB;

-- ==================== 16. 代理系统 ====================

-- 激活码表
CREATE TABLE IF NOT EXISTS activation_codes (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code            VARCHAR(19) NOT NULL UNIQUE COMMENT '16位分4组，如XXXX-XXXX-XXXX-XXXX',
  status          ENUM('unused', 'used', 'cancelled') DEFAULT 'unused',
  used_by         INT UNSIGNED DEFAULT NULL COMMENT '使用者玩家ID',
  used_at         DATETIME DEFAULT NULL,
  seller_id       INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '销售者玩家ID，0=公司',
  price           DECIMAL(10,2) DEFAULT 999.00,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_used_by (used_by)
) ENGINE=InnoDB;

-- 代理关系表
CREATE TABLE IF NOT EXISTS agent_relations (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id       INT UNSIGNED NOT NULL COMMENT '玩家ID',
  superior_id     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上级玩家ID，0=公司',
  level           INT NOT NULL DEFAULT 1 COMMENT '1=直推, 2=间推',
  activation_code_id INT UNSIGNED DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_player_id (player_id),
  INDEX idx_superior_id (superior_id)
) ENGINE=InnoDB;

-- 代理表（代理等级和团队数据）
CREATE TABLE IF NOT EXISTS agents (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id       INT UNSIGNED NOT NULL UNIQUE COMMENT '玩家ID',
  level           INT NOT NULL DEFAULT 1 COMMENT '代理等级 Lv.1-6',
  direct_orders   INT DEFAULT 0 COMMENT '直推客单数',
  team_orders     INT DEFAULT 0 COMMENT '团队总客单数',
  high_level_count INT DEFAULT 0 COMMENT '高级人数（下级代理数）',
  status          ENUM('normal', 'frozen') DEFAULT 'normal',
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_level (level),
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- 佣金配置表
CREATE TABLE IF NOT EXISTS agent_commission_config (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level           INT NOT NULL COMMENT '代理等级 1-6',
  direct_commission DECIMAL(5,2) DEFAULT 18.00 COMMENT '直推佣金比例 %',
  indirect_commission DECIMAL(5,2) DEFAULT 5.00 COMMENT '间推佣金比例 %',
  team_bonus      DECIMAL(5,2) DEFAULT 0.00 COMMENT '团队奖金比例 %',
  team_bonus_generations INT DEFAULT 0 COMMENT '团队奖金向下代数',
  UNIQUE KEY uk_level (level)
) ENGINE=InnoDB;

-- 升级条件配置表
CREATE TABLE IF NOT EXISTS agent_upgrade_config (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_level    INT NOT NULL COMMENT '目标等级 2-6',
  direct_orders_required INT DEFAULT 0 COMMENT '直推单数要求',
  team_orders_required INT DEFAULT 0 COMMENT '团队单数要求',
  high_level_count_required INT DEFAULT 0 COMMENT '高级人数要求',
  high_level_type INT DEFAULT 0 COMMENT '要求的高级等级（2=Lv.2, 3=Lv.3...）',
  UNIQUE KEY uk_target_level (target_level)
) ENGINE=InnoDB;

-- 佣金表
CREATE TABLE IF NOT EXISTS commissions (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id        INT UNSIGNED NOT NULL,
  order_id        INT UNSIGNED NOT NULL,
  level           INT NOT NULL DEFAULT 1 COMMENT '1=直推, 2=间推',
  amount          DECIMAL(10,2) NOT NULL COMMENT '佣金金额',
  type            ENUM('base', 'team_bonus') DEFAULT 'base' COMMENT '基础佣金/团队奖金',
  status          ENUM('pending', 'settled', 'withdrawn') DEFAULT 'pending',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at      DATETIME DEFAULT NULL,
  INDEX idx_agent_id (agent_id),
  INDEX idx_order_id (order_id),
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- 提现表
CREATE TABLE IF NOT EXISTS withdrawals (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id        INT UNSIGNED NOT NULL,
  amount          DECIMAL(10,2) NOT NULL COMMENT '提现金额',
  status          ENUM('pending', 'paid', 'rejected') DEFAULT 'pending',
  apply_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at         DATETIME DEFAULT NULL,
  remark          VARCHAR(255) DEFAULT NULL,
  INDEX idx_agent_id (agent_id),
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  buyer_id        INT UNSIGNED NOT NULL COMMENT '购买者玩家ID',
  seller_id       INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '代理玩家ID，0=公司',
  activation_code_id INT UNSIGNED NOT NULL,
  amount          DECIMAL(10,2) DEFAULT 999.00,
  status          ENUM('pending', 'paid', 'cancelled') DEFAULT 'pending',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at         DATETIME DEFAULT NULL,
  INDEX idx_buyer_id (buyer_id),
  INDEX idx_seller_id (seller_id),
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- ==================== 初始化代理配置数据 ====================

INSERT INTO agent_commission_config (level, direct_commission, indirect_commission, team_bonus, team_bonus_generations) VALUES
(1, 18.00, 5.00, 0.00, 0),
(2, 18.00, 5.00, 0.00, 0),
(3, 18.00, 5.00, 2.00, 2),
(4, 18.00, 5.00, 2.00, 3),
(5, 18.00, 5.00, 2.00, 4),
(6, 18.00, 5.00, 2.00, 99);

INSERT INTO agent_upgrade_config (target_level, direct_orders_required, team_orders_required, high_level_count_required, high_level_type) VALUES
(2, 2, 5, 0, 0),
(3, 5, 30, 2, 2),
(4, 10, 100, 5, 3),
(5, 15, 500, 10, 4),
(6, 20, 2000, 20, 5);

-- ==================== 完成 ====================
SELECT 'All 30 tables created successfully!' AS result;
