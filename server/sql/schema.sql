-- 客群数据系统 · MySQL Schema（v1）
-- 幂等：CREATE TABLE IF NOT EXISTS，可重复执行
-- 约定：utf8mb4 / InnoDB / DATETIME(3) / 外键由应用层保证

-- ============ 系统管理 ============

CREATE TABLE IF NOT EXISTS sys_user (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  name          VARCHAR(50)  NOT NULL,
  role          VARCHAR(30)  NOT NULL,
  must_change_password TINYINT NOT NULL DEFAULT 0,  -- 1=首次登录强制修改密码
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_user_store (
  user_id  BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS brand (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(64) NOT NULL UNIQUE,
  name       VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS store (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code           VARCHAR(64)  NOT NULL UNIQUE,
  name           VARCHAR(128) NOT NULL,
  brand_id       BIGINT UNSIGNED NULL,
  location       VARCHAR(255) NOT NULL DEFAULT '',
  business_hours VARCHAR(64)  NOT NULL DEFAULT '',
  is_demo        TINYINT      NOT NULL DEFAULT 0,
  status         TINYINT      NOT NULL DEFAULT 1,
  bound_at       DATETIME(3)  NULL,             -- 控制台绑定时间（品牌 token 下选/建店后标记）
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_brand (brand_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS site_token (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token        VARCHAR(64) NOT NULL UNIQUE,
  name         VARCHAR(64) NOT NULL,
  brand_id     BIGINT UNSIGNED NULL,            -- 品牌 token（一品牌至多一个）
  store_id     BIGINT UNSIGNED NULL,            -- 门店 token（一门店至多一个）
  enabled      TINYINT     NOT NULL DEFAULT 1,
  last_used_at DATETIME(3) NULL,
  install_code VARCHAR(16) NULL,                -- 门店现场安装短码（一次性，可过期）
  install_code_expires_at DATETIME(3) NULL,     -- 短码过期时间
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_brand (brand_id),
  UNIQUE KEY uk_store (store_id),
  KEY idx_brand (brand_id),
  KEY idx_store (store_id),
  UNIQUE KEY uk_install_code (install_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 控制台部署记录（门店员工通过门店 Wi-Fi/同子网访问 camera-local-console 用）
CREATE TABLE IF NOT EXISTS console_deployment (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id         BIGINT UNSIGNED NOT NULL UNIQUE, -- 一店一台控制台
  console_id       VARCHAR(64) NOT NULL DEFAULT '',
  name             VARCHAR(128) NOT NULL DEFAULT '',
  ip_address       VARCHAR(64) NOT NULL DEFAULT '',
  port             INT NOT NULL DEFAULT 3000,
  tunnel_port      INT NULL,               -- 异地访问隧道端口（后端自动分配）
  tunnel_token     VARCHAR(64) NOT NULL DEFAULT '', -- 隧道访问凭证（随机，管理面板展示完整 URL）
  tunnel_last_seen DATETIME(3) NULL,       -- 隧道最后在线（WS 心跳）
  ssh_port         INT NULL,               -- 反向 SSH 隧道端口（autossh -R，后端自动分配）
  ssh_last_seen    DATETIME(3) NULL,       -- SSH 隧道最后心跳
  update_task      TEXT NULL,              -- 远程更新任务（JSON：{version,url,sha256,platform,status,message,requestedAt,finishedAt}）
  last_seen_at     DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 设备 ============

CREATE TABLE IF NOT EXISTS camera_device (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_index_code  VARCHAR(64) NOT NULL UNIQUE,
  camera_index_code  VARCHAR(64) NOT NULL DEFAULT '',
  mac_address        VARCHAR(32) NOT NULL DEFAULT '',
  store_id           BIGINT UNSIGNED NULL,
  device_name        VARCHAR(128) NOT NULL DEFAULT '',
  ip_address         VARCHAR(64)  NOT NULL DEFAULT '',
  position_type      VARCHAR(20)  NOT NULL DEFAULT 'UNKNOWN',
  status             TINYINT      NOT NULL DEFAULT 1,
  last_report_at     DATETIME(3)  NULL,
  last_body_event_at DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_store (store_id),
  KEY idx_position (position_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============ 接入与解析 ============

CREATE TABLE IF NOT EXISTS camera_raw_event (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id          VARCHAR(128) NULL,             -- 边缘侧 eventId；缺失时为 NULL（唯一索引允许多个 NULL）
  device_index_code VARCHAR(64)  NOT NULL DEFAULT '',
  store_id          BIGINT UNSIGNED NULL,
  event_type        VARCHAR(30)  NOT NULL,
  raw_json          MEDIUMTEXT   NOT NULL,
  happen_time       DATETIME(3)  NULL,
  receive_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  parse_status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
  parse_error       VARCHAR(500) NOT NULL DEFAULT '',
  UNIQUE KEY uk_event (event_id),
  KEY idx_device_time (device_index_code, happen_time),
  KEY idx_receive (receive_time),
  KEY idx_status (parse_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS camera_people_flow (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_index_code   VARCHAR(64) NOT NULL,
  store_id            BIGINT UNSIGNED NULL,
  camera_index_code   VARCHAR(64) NOT NULL DEFAULT '',
  stat_time           DATETIME(3) NOT NULL,
  enter_count         INT NOT NULL DEFAULT 0,
  exit_count          INT NOT NULL DEFAULT 0,
  pass_count          INT NOT NULL DEFAULT 0,
  duplicate_people    INT NOT NULL DEFAULT 0,
  statistical_methods VARCHAR(20) NOT NULL DEFAULT 'realTime',
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_store_time (store_id, stat_time),
  KEY idx_device_time (device_index_code, stat_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS camera_human_body (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_index_code VARCHAR(64) NOT NULL,
  store_id          BIGINT UNSIGNED NULL,
  camera_index_code VARCHAR(64) NOT NULL DEFAULT '',
  human_id          VARCHAR(64) NOT NULL DEFAULT '',
  event_time        DATETIME(3) NOT NULL,
  age_group         VARCHAR(20) NOT NULL DEFAULT '',
  gender            VARCHAR(10) NOT NULL DEFAULT '',
  stay_time         INT NOT NULL DEFAULT 0,
  similarity        INT NOT NULL DEFAULT 0,
  mask              VARCHAR(10) NOT NULL DEFAULT '',
  hat               VARCHAR(10) NOT NULL DEFAULT '',
  things            VARCHAR(10) NOT NULL DEFAULT '',
  jacket_color      VARCHAR(20) NOT NULL DEFAULT '',
  jacket_type       VARCHAR(30) NOT NULL DEFAULT '',
  pants_color       VARCHAR(20) NOT NULL DEFAULT '',
  pants_type        VARCHAR(30) NOT NULL DEFAULT '',
  human_tag_id      INT NULL,
  tag_rule_version  INT NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_store_time (store_id, event_time),
  KEY idx_device_time (device_index_code, event_time),
  KEY idx_tag (human_tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS human_tag (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(20) NOT NULL UNIQUE,
  name         VARCHAR(30) NOT NULL,
  rule_version INT NOT NULL DEFAULT 1,
  rule_json    TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
