# campus-net-2.0

面向本校学生的校园综合服务网站：办事入口、往年真题、校园社区汇到一处。

- 姓名：【填昵称或留空】
- 学校：【你的学校】
- 技术：纯 HTML + CSS 手写，无任何框架，代码带中文注释

## 页面清单（对照设计稿 P1–P14）

| 页面 | 对应设计稿 | 说明 |
|---|---|---|
| [index.html](index.html) | P1 首页 | 顶部导航 + Hero 提问框 + 三栏面板 |
| [app-center.html](app-center.html) | P2 应用中心 | 校园百宝箱，卡片网格（点首卡可进详情页） |
| [app-detail.html](app-detail.html) | P3 办事入口详情 | 企微导航条目：分步指引 + 截图占位 + 纠错 |
| [exam-lib.html](exam-lib.html) | P4 真题库 | 学院/学期筛选侧栏 + 真题列表 + AI 入口 |
| [exam-qa.html](exam-qa.html) | P5 AI 问答展开态 | 就某份真题的对话式问答 |
| [exam-upload.html](exam-upload.html) | P6 上传真题 | 表单：文件、科目、学期、答案解析 |
| [community.html](community.html) | P7 校园社区 | 六版块信息流 |
| [admin-login.html](admin-login.html) | P8 管理后台登录 | 按学校选择 + 口令，独立入口 |
| [admin-console.html](admin-console.html) | P9 管理后台工作台 | 左侧后台导航 + 数据表格 |
| [profile.html](profile.html) | P10 个人中心 | 用户卡片 + 多面板设置 |
| [login.html](login.html) | P11 登录 | 全屏居中卡片表单 |
| [register.html](register.html) | P12 注册 | 多列表单 + 验证码行 |
| [forgot-password.html](forgot-password.html) | P13 忘记密码 | 步骤条 + 按钮变体 |
| [guest-gate.html](guest-gate.html) | P14 游客访问控制 | 权限矩阵 + 拦截弹窗规范 |

设计令牌（全站统一的颜色 / 圆角 / 布局变量）在 [assets/tokens.css](assets/tokens.css)。

## 目录结构

```
campus-net-2.0/
├── index.html            # 首页（P1）
├── *.html                # 其余 13 个页面（见上表）
├── assets/tokens.css     # 设计令牌：CSS 变量
└── README.md             # 本文件
```

## 本地预览

直接双击 `index.html` 用浏览器打开即可；页面之间已用链接互相连通。

## 说明

- 视觉与结构对照导师仓库 stone2005/campus2.0-course 的 `design/` 设计稿（P1–P14）重写为学习版：保留视觉效果，代码展开、加中文注释、补语义标签
- 旧版 P0 首页骨架见历史提交 f4eff4a
