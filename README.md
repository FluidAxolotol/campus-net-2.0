# campus-net-2.0

校内网 2.0：一个把「校园工具 / 真题库 / 社区」做成真实全栈链路的课程项目。

- 前端：原生 HTML + CSS + JavaScript（ES Module，无框架、无打包器）
- 后端：Node.js 24 + Express 5
- 数据库：MySQL 8
- 入口：Nginx 反向代理 + 静态服务器 + X-Accel 内部文件下载
- 安全：CSRF 双提交、MySQL 会话、scrypt 密码哈希、管理员 TOTP 双因素、学校数据隔离、注册审核

> 仓库文件不包含真实姓名、学号等个人信息；演示账号均为虚构数据。

## 1. 这套系统做了什么

| 角色 | 能力 |
|---|---|
| 游客 | 按学校浏览工具、真题列表、社区帖子；选择学校；不能下载/发帖/提问 |
| 学生 | 注册（待审核）→ 登录 → 首页/应用/真题/社区 → 上传真题（待审核）→ 下载已通过真题 → 就真题问答 → 发帖/点赞 → 个人中心改资料/改密 |
| 管理员 | 独立入口登录：密码 + 腾讯身份验证器动态码；首次登录强制改密 + 扫码绑定；审核注册；审核真题；管理帖子/纠错/找回密码；切换管理学校；查看审计日志；修改管理员密码 |

学校隔离是硬约束：每条业务 SQL 都带 `school_id`；学生的学校来自服务端会话，管理员的学校来自管理员会话中的 `currentSchoolId`。前端传 `schoolId` 不能越权，跨校资源统一返回 404。

## 2. 架构

```text
浏览器
  │  HTTP（本地 8088 / 生产 443）
  ▼
Nginx ── 静态文件（web/）
  │  └─ /assets/*.css|js     直接返回
  │
  ├─ /api/*  ──反向代理──►  Express 5（127.0.0.1:3100）
  │                           ├─ 请求 id / 日志 / 安全头
  │                           ├─ CSRF 双提交
  │                           ├─ 两套 MySQL 会话
  │                           ├─ 路由 → service → SQL
  │                           └─ 统一错误处理
  │
  └─ /__files/*（internal）◄── X-Accel-Redirect（Express 鉴权后指路）
                              └─ 真实文件在 server/uploads，不在 web 根目录
                                       │
                                       ▼
                                    MySQL 8
```

设计文档：

- [架构设计](docs/01-架构设计.md)
- [详细设计](docs/02-详细设计.md)
- [接口文档](docs/03-接口文档.md)
- [数据库设计](docs/04-数据库设计.md)
- [部署与运行](docs/05-部署运行.md)
- [代码逐行讲解](docs/06-代码逐行讲解.md)

## 3. 目录结构

```text
campus-net-2.0/
├── web/                      # 前端（Nginx 静态根目录）
│   ├── *.html                # 14 个页面
│   └── assets/
│       ├── tokens.css        # 设计令牌
│       ├── site.css          # 动态组件样式
│       └── js/
│           ├── api.js        # 统一 fetch / CSRF / 上传 / 下载
│           ├── auth.js       # 登录态、学校切换、导航
│           ├── ui.js         # DOM、toast、弹窗、状态
│           └── pages/*.js    # 一页一模块
├── server/                   # 后端
│   ├── src/
│   │   ├── app.js            # Express 装配线
│   │   ├── server.js         # 启动、健康检查、优雅退出
│   │   ├── config/env.js     # 环境变量
│   │   ├── db/pool.js        # 连接池与事务
│   │   ├── middleware/       # 会话、CSRF、鉴权、限流、错误
│   │   ├── modules/          # auth / admin-auth / home / apps / exams / qa / posts / profile / admin
│   │   └── utils/            # 密码、TOTP、AES、序列化、文件、校验
│   ├── sql/001_init.sql      # MySQL 8 表结构
│   ├── scripts/              # migrate / seed / dev-totp / smoke
│   ├── test/                 # 单元 + 集成测试
│   └── uploads/              # 文件目录（gitignore）
├── deploy/
│   ├── nginx/                # 本地 / Docker / 生产配置
│   ├── systemd/              # campus-api.service
│   └── scripts/              # release / healthcheck / backup
├── docker-compose.yml        # MySQL + API + Nginx 一键本地全栈
└── docs/                     # 架构、详细设计、接口、部署、逐行讲解
```

## 4. 本地运行

### 4.1 一键全栈（推荐，Docker）

前提：安装 Docker Desktop，并确保 Docker 引擎已启动。

```bash
cd campus-net-2.0
docker compose up --build
```

打开 <http://localhost:8088/>。

Compose 会自动：

1. 启动 MySQL 8（宿主机 3308 端口）；
2. 构建 Express 镜像，执行 `npm run migrate && npm run seed && npm start`；
3. 启动 Nginx，静态页由 Nginx 返回，`/api` 反代到 API 容器。

停止：

```bash
docker compose down
```

清空数据库并重新演示（会删除数据卷）：

```bash
docker compose down -v
docker compose up --build
```

### 4.2 本机开发（MySQL 容器 + Node + 可选 Nginx）

```bash
cd campus-net-2.0
docker compose up -d mysql

cd server
cp .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

此时可以直接访问 <http://127.0.0.1:3100/>（开发环境由 Express 兜底静态文件）。
要验证 Nginx 链路，用 Docker 启动 Nginx，或把 `deploy/nginx/campus2.local.conf` 的 root 改成本机 `web/` 路径后启动本机 Nginx。

### 4.3 演示账号（seed 生成，均可修改）

| 角色 | 账号 | 初始密码 | 说明 |
|---|---|---|---|
| 管理员 | `campusadmin` | `Admin@2026` | 首次登录强制改密 + 扫码绑定腾讯身份验证器 |
| 学生（已审核） | `alice@mail.sysu.edu.cn` | `Student@2026` | 中山大学 |
| 学生（已审核） | `bob@mail.sysu.edu.cn` | `Student@2026` | 中山大学 |
| 学生（已审核） | `lily@mail.scut.edu.cn` | `Student@2026` | 华南理工大学 |
| 学生（待审核） | `pending@mail.sysu.edu.cn` | `Student@2026` | 用来演示后台注册审核 |

管理员首次登录流程：

1. 选择学校，输入 `campusadmin / Admin@2026`；
2. 页面显示二维码；
3. 微信搜索「腾讯身份验证器」小程序，扫二维码添加账户；
4. 设置新密码，输入小程序当前 6 位动态码；
5. 保存一次性恢复码（只显示一次）；
6. 进入管理后台。以后登录需要密码 + 动态码。

本地没有验证器时，可在 `server/` 下生成当前动态码：

```bash
npm run dev:totp
```

该脚本从数据库读取 demo 管理员密钥；生产环境会拒绝执行。

## 5. 需求对应关系

| 设计要求 | 实现位置 |
|---|---|
| 原生 HTML/CSS/JS，无框架 | `web/`，所有页面；共享模块在 `web/assets/js/` |
| Node + Express 后端 | `server/src/app.js`、`server/src/modules/` |
| Nginx 前置代理，动态请求转 Express | `deploy/nginx/*.conf`、Docker `nginx` 服务 |
| MySQL 8 | `server/sql/001_init.sql`、`server/src/db/pool.js` |
| 学校数据隔离 | 每张业务表带 `school_id`；组合外键；`resolveSchool()`、`requireAdminActive`；跨校 404 |
| 管理员登录动态密码（腾讯身份认证小程序） | `server/src/modules/admin-auth/`；标准 TOTP，二维码用 `qrcode` 生成；腾讯身份验证器扫码 |
| 注册用户需要审核 | `users.status = pending`；管理员 `/api/admin/registrations/:id/approve` |
| 现有 14 个页面 | `web/`，保留原视觉，改为真实数据渲染 |

课程材料里的 P0 取舍也保留了：

- 不做真实邮件服务：找回密码改为「提交申请 → 管理员生成临时密码」；
- 不做真实 AI：真题问答为规则生成演示版，明确标注；
- 收藏、评论等 P1 功能不假装实现，前台会提示「P1 未实现」；
- 管理员是平台级账号，登录后选择 `currentSchoolId`，后台操作只作用于当前学校。

## 6. 测试与验证

```bash
cd server

npm run test:unit          # 纯函数：TOTP、密码哈希、AES、序列化
npm run test:integration   # 真实 Express + MySQL 测试库 campus2_test
npm test                   # 单元 + 集成
npm run smoke              # 真实 Edge/Chrome 打开页面，收集 JS 错误
```

集成测试覆盖：

- 注册 → pending 登录 403 → 管理员审核 → 登录 → `/me`；
- CSRF 缺失返回 403；
- 学生本校数据可读、跨校 404、URL 传 `schoolId` 不能越权；
- 发帖与点赞事务；
- 管理员切换学校后的数据隔离；
- TOTP 同码重放返回 401；
- PDF 上传 → 管理员审核 → 本人下载 → 跨校 404；
- 伪造 `.pdf` 的文本文件被魔数校验拒绝；
- 真题问答登录与学校隔离。

测试库独立：`DB_NAME=campus2_test`，测试前会清表重建，不碰演示数据。

## 7. 环境变量

完整示例见 [`server/.env.example`](server/.env.example)。生产必须替换：

- `SESSION_SECRET`、`ADMIN_SESSION_SECRET`：两套不同随机密钥；
- `TOTP_ENCRYPTION_KEY`：64 位十六进制；
- `DB_PASSWORD`；
- `NODE_ENV=production`；
- `USE_X_ACCEL=true`（配合 Nginx `/__files/`）；
- `RATE_LIMIT_DISABLED=0`。

## 8. 部署提示

- 生产 Nginx 模板：[`deploy/nginx/campus2.conf`](deploy/nginx/campus2.conf)
- systemd：[`deploy/systemd/campus-api.service`](deploy/systemd/campus-api.service)
- 发布/健康检查/备份：[`deploy/scripts/`](deploy/scripts/)
- 生产上传目录放在 `/srv/campus2.0/shared/uploads`，不在 web 根目录；
- 加 HTTPS 后 Cookie 会带上 `Secure`，Express 开启 `trust proxy`。

## 9. 学习建议

如果你刚开始学全栈，不要从第一行读到第一万行。按这个顺序读：

1. 打开一个页面，看 DevTools Network 里的请求；
2. 读 `web/assets/js/api.js`，明白一次请求如何带 Cookie 与 CSRF；
3. 读 `server/src/app.js`，看请求按什么顺序经过中间件；
4. 读 `server/src/modules/auth/`，跟一次登录；
5. 读 `server/src/modules/admin-auth/`，看密码 + TOTP 的状态机；
6. 读 `server/src/modules/exams/`，看文件上传与事务；
7. 最后读 `docs/06-代码逐行讲解.md`，按文件逐个对照。

> 这个项目是课程练习，不是生产级系统。上线前请让有经验的工程师做一次安全评审。
