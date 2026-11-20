-- ============================================================
-- 校内网 2.0 数据库结构（MySQL 8）
-- 设计原则：
--   1. schools 是根节点，业务表全部带 school_id；
--   2. 能组合外键的地方就组合外键，从数据库层阻止跨校关联；
--   3. 会话只存 SHA-256 后的 sid，不存原始 Cookie；
--   4. 软删除优先，审计留痕。
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(64)  NOT NULL PRIMARY KEY,
  applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 学校（多租户的根）
CREATE TABLE IF NOT EXISTS schools (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(80)  NOT NULL,
  code         VARCHAR(32)  NOT NULL,
  email_domain VARCHAR(120) NOT NULL,
  status       ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_schools_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 平台级管理员：不挂在某一所学校下；
-- 登录后选择 currentSchoolId，后台操作只作用于当前学校。
CREATE TABLE IF NOT EXISTS admins (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username              VARCHAR(64)  NOT NULL,
  display_name          VARCHAR(64)  NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  totp_secret_encrypted VARCHAR(255) NULL COMMENT 'AES-256-GCM 加密后的 TOTP 密钥',
  totp_confirmed        TINYINT(1)   NOT NULL DEFAULT 0,
  must_change_password  TINYINT(1)   NOT NULL DEFAULT 1,
  last_totp_step        BIGINT UNSIGNED NULL COMMENT '防重放：上一次成功使用的时间步长',
  failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until          DATETIME(3)  NULL,
  status                ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_admins_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 管理员恢复码：只存哈希，一次性使用
CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_id   BIGINT UNSIGNED NOT NULL,
  code_hash  CHAR(64) NOT NULL,
  used_at    DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_recovery_hash (code_hash),
  KEY idx_recovery_admin (admin_id, used_at),
  CONSTRAINT fk_recovery_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 学生用户：注册后 pending，管理员审核通过后才能登录
CREATE TABLE IF NOT EXISTS users (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id             INT UNSIGNED NOT NULL,
  student_no            VARCHAR(32)  NOT NULL,
  email                 VARCHAR(160) NOT NULL,
  display_name          VARCHAR(40)  NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  degree                VARCHAR(10)  NOT NULL DEFAULT '本科',
  enroll_year           SMALLINT UNSIGNED NOT NULL,
  college               VARCHAR(80)  NULL,
  bio                   VARCHAR(200) NULL,
  status                ENUM('pending','active','rejected','disabled') NOT NULL DEFAULT 'pending',
  reject_reason         VARCHAR(200) NULL,
  failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until          DATETIME(3)  NULL,
  reviewed_by           BIGINT UNSIGNED NULL,
  reviewed_at           DATETIME(3)  NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_school_student (school_id, student_no),
  -- 组合外键需要这个唯一键：让 (user_id, school_id) 能被其他表引用
  UNIQUE KEY uq_users_id_school (id, school_id),
  KEY idx_users_school_status (school_id, status, created_at),
  CONSTRAINT fk_users_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_users_reviewer FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 用户会话：id 存 sha256(随机 sid)，data 存 express-session 的 JSON
CREATE TABLE IF NOT EXISTS user_sessions (
  id           CHAR(64) NOT NULL PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  data         JSON NOT NULL,
  expires_at   DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_user_sessions_expiry (expires_at),
  KEY idx_user_sessions_user (user_id),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 管理员会话：stage 驱动 登录 → 绑定/动态码 → active
CREATE TABLE IF NOT EXISTS admin_sessions (
  id           CHAR(64) NOT NULL PRIMARY KEY,
  admin_id     BIGINT UNSIGNED NOT NULL,
  data         JSON NOT NULL,
  expires_at   DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_admin_sessions_expiry (expires_at),
  KEY idx_admin_sessions_admin (admin_id),
  CONSTRAINT fk_admin_sessions_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 应用中心：办事入口/小工具
CREATE TABLE IF NOT EXISTS apps (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id  INT UNSIGNED NOT NULL,
  title      VARCHAR(120) NOT NULL,
  category   VARCHAR(40)  NOT NULL,
  summary    VARCHAR(255) NOT NULL,
  icon       VARCHAR(16)  NOT NULL DEFAULT '🧭',
  steps      JSON NOT NULL,
  views      INT UNSIGNED NOT NULL DEFAULT 0,
  status     ENUM('active','hidden') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_apps_id_school (id, school_id),
  KEY idx_apps_school_status (school_id, status, category),
  CONSTRAINT fk_apps_school FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 文件：物理文件在 uploads/，这里存元数据；storage_key 是 UUID 文件名
CREATE TABLE IF NOT EXISTS files (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id     INT UNSIGNED NOT NULL,
  uploader_id   BIGINT UNSIGNED NOT NULL,
  storage_key   VARCHAR(100) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(80)  NOT NULL,
  size_bytes    BIGINT UNSIGNED NOT NULL,
  sha256        CHAR(64) NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_files_storage (storage_key),
  UNIQUE KEY uq_files_id_school (id, school_id),
  KEY idx_files_school (school_id, created_at),
  CONSTRAINT fk_files_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_files_uploader FOREIGN KEY (uploader_id, school_id)
    REFERENCES users(id, school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 真题：pending → approved / rejected
CREATE TABLE IF NOT EXISTS exams (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id      INT UNSIGNED NOT NULL,
  file_id        BIGINT UNSIGNED NOT NULL,
  uploader_id    BIGINT UNSIGNED NOT NULL,
  title          VARCHAR(160) NOT NULL,
  subject        VARCHAR(80)  NOT NULL,
  college        VARCHAR(80)  NOT NULL,
  semester       VARCHAR(20)  NOT NULL,
  exam_type      VARCHAR(20)  NOT NULL DEFAULT '期末',
  has_answer     TINYINT(1)   NOT NULL DEFAULT 0,
  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  review_note    VARCHAR(255) NULL,
  reviewed_by    BIGINT UNSIGNED NULL,
  reviewed_at    DATETIME(3) NULL,
  download_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_exams_id_school (id, school_id),
  KEY idx_exams_school_status (school_id, status, created_at, id),
  KEY idx_exams_school_subject (school_id, status, subject, semester),
  CONSTRAINT fk_exams_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_exams_file FOREIGN KEY (file_id, school_id) REFERENCES files(id, school_id),
  CONSTRAINT fk_exams_uploader FOREIGN KEY (uploader_id, school_id) REFERENCES users(id, school_id),
  CONSTRAINT fk_exams_reviewer FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 社区版块（每所学校各有一套）
CREATE TABLE IF NOT EXISTS boards (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id  INT UNSIGNED NOT NULL,
  code       VARCHAR(20) NOT NULL,
  name       VARCHAR(40) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_boards_school_code (school_id, code),
  UNIQUE KEY uq_boards_id_school (id, school_id),
  CONSTRAINT fk_boards_school FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 帖子
CREATE TABLE IF NOT EXISTS posts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id     INT UNSIGNED NOT NULL,
  board_id      INT UNSIGNED NOT NULL,
  author_id     BIGINT UNSIGNED NOT NULL,
  title         VARCHAR(160) NOT NULL,
  content       TEXT NOT NULL,
  status        ENUM('published','hidden','deleted') NOT NULL DEFAULT 'published',
  like_count    INT UNSIGNED NOT NULL DEFAULT 0,
  comment_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_posts_id_school (id, school_id),
  KEY idx_posts_school_feed (school_id, status, created_at, id),
  KEY idx_posts_school_board (school_id, board_id, status, created_at, id),
  CONSTRAINT fk_posts_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_posts_board FOREIGN KEY (board_id, school_id) REFERENCES boards(id, school_id),
  CONSTRAINT fk_posts_author FOREIGN KEY (author_id, school_id) REFERENCES users(id, school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 点赞：主键保证同一用户对同一帖子只能点一次
CREATE TABLE IF NOT EXISTS post_likes (
  post_id    BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  school_id  INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (post_id, user_id),
  KEY idx_likes_school (school_id, created_at),
  CONSTRAINT fk_likes_post FOREIGN KEY (post_id, school_id) REFERENCES posts(id, school_id) ON DELETE CASCADE,
  CONSTRAINT fk_likes_user FOREIGN KEY (user_id, school_id) REFERENCES users(id, school_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 真题问答：P0 用规则引擎生成演示答案，不调用外部 AI
CREATE TABLE IF NOT EXISTS qa_threads (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id  INT UNSIGNED NOT NULL,
  exam_id    BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  question   VARCHAR(500) NOT NULL,
  answer     TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_qa_id_school (id, school_id),
  KEY idx_qa_school_exam (school_id, exam_id, created_at),
  CONSTRAINT fk_qa_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_qa_exam FOREIGN KEY (exam_id, school_id) REFERENCES exams(id, school_id),
  CONSTRAINT fk_qa_user FOREIGN KEY (user_id, school_id) REFERENCES users(id, school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 纠错反馈
CREATE TABLE IF NOT EXISTS corrections (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id   INT UNSIGNED NOT NULL,
  target_type ENUM('app') NOT NULL DEFAULT 'app',
  target_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  content     VARCHAR(500) NOT NULL,
  status      ENUM('open','resolved','ignored') NOT NULL DEFAULT 'open',
  admin_note  VARCHAR(255) NULL,
  resolved_by BIGINT UNSIGNED NULL,
  resolved_at DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_corrections_id_school (id, school_id),
  KEY idx_corrections_school_status (school_id, status, created_at),
  CONSTRAINT fk_corrections_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_corrections_user FOREIGN KEY (user_id, school_id) REFERENCES users(id, school_id),
  CONSTRAINT fk_corrections_admin FOREIGN KEY (resolved_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 审计日志：后台关键操作都留痕
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id   INT UNSIGNED NOT NULL,
  actor_type  ENUM('admin','user','system') NOT NULL,
  actor_id    BIGINT UNSIGNED NULL,
  action      VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NULL,
  target_id   BIGINT UNSIGNED NULL,
  detail      JSON NULL,
  ip          VARCHAR(64) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_school_time (school_id, created_at),
  CONSTRAINT fk_audit_school FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 找回密码申请：P0 不接邮件，改为提交给管理员重置
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id   INT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  note        VARCHAR(255) NULL,
  status      ENUM('open','done','ignored') NOT NULL DEFAULT 'open',
  handled_by  BIGINT UNSIGNED NULL,
  handled_at  DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_reset_id_school (id, school_id),
  KEY idx_reset_school_status (school_id, status, created_at),
  CONSTRAINT fk_reset_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id, school_id) REFERENCES users(id, school_id),
  CONSTRAINT fk_reset_admin FOREIGN KEY (handled_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
