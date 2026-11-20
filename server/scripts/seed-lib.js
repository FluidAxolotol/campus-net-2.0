// ============================================================
// 演示数据种子
// 幂等：按邮箱 / 标题 / code 查重，重复执行不会重复插入。
// 只在本地演示与联调使用，不要在生产跑。
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../src/config/env.js';
import { query, queryOne, withTransaction } from '../src/db/pool.js';
import {
  hashPassword, generateTotpSecret, encryptSecret,
} from '../src/utils/crypto.js';

// ---------- 最小可打开 PDF（内容用英文，避免字体问题） ----------
function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function makeDemoPdf(title, lines = []) {
  const content = [
    'BT',
    '/F1 20 Tf',
    '72 780 Td',
    `(${escapePdfText(title)}) Tj`,
    '/F1 12 Tf',
    '0 -32 Td',
    ...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, '0 -18 Td']),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// ---------- 管理员 ----------
export async function ensureAdminAccount({ username, displayName, password }) {
  const existing = await queryOne('SELECT id, must_change_password FROM admins WHERE username = ? LIMIT 1', [username]);
  if (existing) {
    return { created: false, id: existing.id, mustChangePassword: Boolean(existing.must_change_password) };
  }
  const passwordHash = await hashPassword(password);
  const totpSecret = generateTotpSecret();
  const result = await query(
    `INSERT INTO admins
       (username, display_name, password_hash, totp_secret_encrypted,
        totp_confirmed, must_change_password, status)
     VALUES (?, ?, ?, ?, 0, 1, 'active')`,
    [username, displayName, passwordHash, encryptSecret(totpSecret)],
  );
  return { created: true, id: result.insertId, mustChangePassword: true };
}

// ---------- 学校 ----------
async function ensureSchool(school) {
  await query(
    `INSERT INTO schools (name, code, email_domain, status)
     VALUES (?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE name = VALUES(name), email_domain = VALUES(email_domain)`,
    [school.name, school.code, school.email_domain],
  );
  return queryOne('SELECT * FROM schools WHERE code = ? LIMIT 1', [school.code]);
}

// ---------- 用户 ----------
async function ensureUser({ schoolId, studentNo, email, displayName, degree, enrollYear, college, status = 'active' }) {
  const existing = await queryOne('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing) return existing.id;
  const passwordHash = await hashPassword(config.seedUserPassword);
  const result = await query(
    `INSERT INTO users
       (school_id, student_no, email, display_name, password_hash,
        degree, enroll_year, college, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [schoolId, studentNo, email, displayName, passwordHash, degree, enrollYear, college, status],
  );
  return result.insertId;
}

// ---------- 版块 ----------
const BOARDS = [
  { code: 'secondhand', name: '二手交易', sort_order: 10 },
  { code: 'lost', name: '失物招领', sort_order: 20 },
  { code: 'carpool', name: '拼车跑腿', sort_order: 30 },
  { code: 'club', name: '社团活动', sort_order: 40 },
  { code: 'study', name: '学习交流', sort_order: 50 },
  { code: 'treehole', name: '表白树洞', sort_order: 60 },
];

async function ensureBoards(schoolId) {
  for (const board of BOARDS) {
    await query(
      `INSERT INTO boards (school_id, code, name, sort_order)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order)`,
      [schoolId, board.code, board.name, board.sort_order],
    );
  }
  return query('SELECT * FROM boards WHERE school_id = ? ORDER BY sort_order', [schoolId]);
}

// ---------- 应用 ----------
function appSteps(schoolName, feature) {
  return [
    { title: `打开企业微信，进入「工作台」`, hint: `${schoolName} · 手机端在底部标签栏中间` },
    { title: `找到「${feature}」入口`, hint: '应用较多时，用顶部搜索直接搜关键词' },
    { title: '按页面提示填写并提交', hint: '提交后可在「我的申请」查看进度' },
  ];
}

async function ensureApp({ schoolId, schoolName, title, category, summary, icon, views }) {
  const existing = await queryOne(
    'SELECT id FROM apps WHERE school_id = ? AND title = ? LIMIT 1',
    [schoolId, title],
  );
  if (existing) return existing.id;
  const steps = appSteps(schoolName, title.replace(/（.*?）/g, ''));
  const result = await query(
    `INSERT INTO apps (school_id, title, category, summary, icon, steps, views, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    [schoolId, title, category, summary, icon, JSON.stringify(steps), views],
  );
  return result.insertId;
}

// ---------- 真题文件 ----------
async function ensureExam({ schoolId, uploaderId, title, subject, college, semester, examType, hasAnswer, status = 'approved', downloadCount = 0 }) {
  const existing = await queryOne(
    'SELECT id FROM exams WHERE school_id = ? AND title = ? LIMIT 1',
    [schoolId, title],
  );
  if (existing) return existing.id;

  await fs.mkdir(config.uploadDir, { recursive: true });
  const storageKey = `${crypto.randomUUID()}.pdf`;
  const absolutePath = path.join(config.uploadDir, storageKey);
  const pdf = makeDemoPdf('Campus Net 2.0 Demo Exam Paper', [
    `Subject: ${subject}`,
    `Semester: ${semester}`,
    `College: ${college}`,
    '',
    'This is a generated demo file for the full-stack coursework.',
    'Replace it with a real exam paper in production.',
  ]);
  await fs.writeFile(absolutePath, pdf);

  try {
    return await withTransaction(async (conn) => {
      const [fileResult] = await conn.execute(
        `INSERT INTO files
           (school_id, uploader_id, storage_key, original_name, mime_type, size_bytes, sha256)
         VALUES (?, ?, ?, ?, 'application/pdf', ?, ?)`,
        [
          schoolId,
          uploaderId,
          storageKey,
          `${title}.pdf`,
          pdf.length,
          crypto.createHash('sha256').update(pdf).digest('hex'),
        ],
      );
      const [examResult] = await conn.execute(
        `INSERT INTO exams
           (school_id, file_id, uploader_id, title, subject, college, semester,
            exam_type, has_answer, status, download_count, reviewed_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          schoolId,
          fileResult.insertId,
          uploaderId,
          title,
          subject,
          college,
          semester,
          examType,
          hasAnswer ? 1 : 0,
          status,
          downloadCount,
        ],
      );
      return examResult.insertId;
    });
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => {});
    throw error;
  }
}

// ---------- 帖子 ----------
async function ensurePost({ schoolId, boardId, authorId, title, content, likes = [] }) {
  const existing = await queryOne(
    'SELECT id FROM posts WHERE school_id = ? AND title = ? LIMIT 1',
    [schoolId, title],
  );
  if (existing) return existing.id;
  const result = await query(
    `INSERT INTO posts (school_id, board_id, author_id, title, content, status)
     VALUES (?, ?, ?, ?, ?, 'published')`,
    [schoolId, boardId, authorId, title, content],
  );
  const postId = result.insertId;

  for (const userId of likes) {
    await query(
      `INSERT INTO post_likes (post_id, user_id, school_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE post_id = post_id`,
      [postId, userId, schoolId],
    );
  }
  if (likes.length) {
    await query('UPDATE posts SET like_count = ? WHERE id = ? AND school_id = ?', [
      likes.length, postId, schoolId,
    ]);
  }
  return postId;
}

// ---------- 主流程 ----------
export async function seedDemoData() {
  const schools = [];
  for (const item of [
    { name: '中山大学', code: 'sysu', email_domain: 'mail.sysu.edu.cn' },
    { name: '华南理工大学', code: 'scut', email_domain: 'mail.scut.edu.cn' },
    { name: '哈尔滨工业大学（深圳）', code: 'hitsz', email_domain: 'hit.edu.cn' },
  ]) {
    schools.push(await ensureSchool(item));
  }

  const [sysu, scut, hitsz] = schools;

  const alice = await ensureUser({
    schoolId: sysu.id, studentNo: '23331001', email: 'alice@mail.sysu.edu.cn',
    displayName: '小张', degree: '本科', enrollYear: 2023, college: '计算机学院',
  });
  const bob = await ensureUser({
    schoolId: sysu.id, studentNo: '23331002', email: 'bob@mail.sysu.edu.cn',
    displayName: '阿华', degree: '本科', enrollYear: 2022, college: '数学学院',
  });
  await ensureUser({
    schoolId: sysu.id, studentNo: '23331999', email: 'pending@mail.sysu.edu.cn',
    displayName: '待审核同学', degree: '本科', enrollYear: 2025,
    college: '外国语学院', status: 'pending',
  });
  const lily = await ensureUser({
    schoolId: scut.id, studentNo: '20230001', email: 'lily@mail.scut.edu.cn',
    displayName: 'Lily', degree: '硕士', enrollYear: 2023, college: '软件学院',
  });
  const dora = await ensureUser({
    schoolId: hitsz.id, studentNo: '20240001', email: 'dora@hit.edu.cn',
    displayName: 'Dora', degree: '本科', enrollYear: 2024, college: '计算机学院',
  });

  for (const school of schools) {
    const boards = await ensureBoards(school.id);

    const appNav = await ensureApp({
      schoolId: school.id,
      schoolName: school.name,
      title: `企微办事导航（${school.name}）`,
      category: '企微导航',
      summary: '企微入口太多找不到？告诉你每个办事的应用入口和菜单路径，一步步走。',
      icon: '🧭',
      views: 2300,
    });
    await ensureApp({
      schoolId: school.id,
      schoolName: school.name,
      title: '竞赛寻搭子',
      category: '寻搭子',
      summary: '蓝桥杯/数模/ACM 想组队？报上竞赛与方向，帮你匹配同校的潜在队友。',
      icon: '🤝',
      views: 1800,
    });
    await ensureApp({
      schoolId: school.id,
      schoolName: school.name,
      title: '空教室查询',
      category: '学习',
      summary: '输入「周三 3–4 节」，列出所有空闲教室。自习不用碰运气。',
      icon: '🏫',
      views: 1500,
    });
    await ensureApp({
      schoolId: school.id,
      schoolName: school.name,
      title: '失物招领智能匹配',
      category: '生活',
      summary: '丢了黑色雨伞？描述特征，自动匹配招领帖和保卫处记录。',
      icon: '☔',
      views: 986,
    });
    await ensureApp({
      schoolId: school.id,
      schoolName: school.name,
      title: '绩点计算器',
      category: '效率',
      summary: '输入成绩和学分，算 GPA、看排名变化，还能做「如果考好一门」的推演。',
      icon: '🧮',
      views: 658,
    });

    const secondhand = boards.find((b) => b.code === 'secondhand');
    const lost = boards.find((b) => b.code === 'lost');
    const study = boards.find((b) => b.code === 'study');

    const authorId = school.id === sysu.id ? alice : (school.id === scut.id ? lily : dora);
    const otherId = school.id === sysu.id ? bob : (school.id === scut.id ? lily : dora);

    await ensurePost({
      schoolId: school.id, boardId: secondhand.id, authorId,
      title: '9 成新台灯 ¥30，毕业出',
      content: '宿舍搬迁出清，明基 ScreenBar 屏幕挂灯，用了不到一年，无划痕。东校区 8 栋自提，可小刀～',
      likes: otherId === authorId ? [] : [otherId],
    });
    await ensurePost({
      schoolId: school.id, boardId: lost.id, authorId: otherId,
      title: '捡到一张校园卡，已交保卫处',
      content: '中午在文科楼 3 楼自习区捡到。已交到保卫处失物招领窗口，失主带证件去认领即可。',
      likes: otherId === authorId ? [] : [authorId],
    });
    await ensurePost({
      schoolId: school.id, boardId: study.id, authorId,
      title: '高数期中复习小组招人（剩 2 席）',
      content: '打算用真题库里的 2024/2025 两年卷子做两轮刷题，每周三晚图书馆研讨间。感兴趣的评论区 +1。',
    });

    // 每所学校至少两份审核通过的真题 + 一份待审核（中山大学）
    await ensureExam({
      schoolId: school.id, uploaderId: authorId,
      title: '高等数学 A（一）· 2025 秋期末', subject: '高等数学 A（一）',
      college: '数学学院', semester: '2025 秋', examType: '期末',
      hasAnswer: true, status: 'approved', downloadCount: 518,
    });
    await ensureExam({
      schoolId: school.id, uploaderId: otherId,
      title: '数据结构 · 2025 春期末', subject: '数据结构',
      college: '计算机学院', semester: '2025 春', examType: '期末',
      hasAnswer: true, status: 'approved', downloadCount: 342,
    });
    if (school.id === sysu.id) {
      await ensureExam({
        schoolId: school.id, uploaderId: bob,
        title: '线性代数 · 2025 秋期中', subject: '线性代数',
        college: '数学学院', semester: '2025 秋', examType: '期中',
        hasAnswer: false, status: 'pending', downloadCount: 0,
      });
      await ensureExam({
        schoolId: school.id, uploaderId: alice,
        title: '操作系统 · 2024 秋期末', subject: '操作系统',
        college: '计算机学院', semester: '2024 秋', examType: '期末',
        hasAnswer: false, status: 'approved', downloadCount: 207,
      });

      const existingCorrection = await queryOne(
        "SELECT id FROM corrections WHERE school_id = ? AND content LIKE '入口改到%' LIMIT 1",
        [sysu.id],
      );
      if (!existingCorrection) {
        await query(
          `INSERT INTO corrections (school_id, target_type, target_id, user_id, content)
           VALUES (?, 'app', ?, ?, ?)`,
          [sysu.id, appNav, alice, '入口改到「后勤服务」了，第 2 步菜单名也变了'],
        );
      }

      const existingReset = await queryOne(
        "SELECT id FROM password_reset_requests WHERE school_id = ? AND user_id = ? AND status = 'open' LIMIT 1",
        [sysu.id, bob],
      );
      if (!existingReset) {
        await query(
          `INSERT INTO password_reset_requests (school_id, user_id, note)
           VALUES (?, ?, ?)`,
          [sysu.id, bob, '换了手机号，想请管理员重置密码（演示数据）'],
        );
      }
    }
  }

  return { schools, users: { alice, bob, lily, dora } };
}
