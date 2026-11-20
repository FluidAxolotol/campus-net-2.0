// ============================================================
// 浏览器冒烟测试：用真实 Edge/Chrome 打开页面，收集 JS 错误
// 前提：MySQL、Node 已启动（npm run dev / npm start）
// 用法：npm run smoke
// 可配置：BASE_URL、CHROME_PATH、SMOKE_ADMIN_PASSWORD
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { config, serverRoot } from '../src/config/env.js';
import { pool, queryOne } from '../src/db/pool.js';
import { decryptSecret, generateTotp } from '../src/utils/crypto.js';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const SHOT_DIR = path.join(serverRoot, 'screenshots');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

async function findBrowser() {
  for (const candidate of CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // 继续找
    }
  }
  throw new Error('没有找到 Chrome/Edge；请设置 CHROME_PATH');
}

async function getAdminTotp() {
  const row = await queryOne(
    'SELECT totp_secret_encrypted FROM admins WHERE username = ? LIMIT 1',
    [config.adminSeed.username],
  );
  if (!row?.totp_secret_encrypted) throw new Error('管理员还没有 TOTP 密钥，先运行 npm run seed');
  return generateTotp(decryptSecret(row.totp_secret_encrypted));
}

const failures = [];

function attachErrorCollector(page, label) {
  page.on('pageerror', (error) => {
    failures.push(`[${label}] JS 异常：${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // /me 在游客状态返回 401、favicon 404 是预期噪音
    if (text.includes('status of 401')) return;
    if (text.includes('favicon.ico')) return;
    failures.push(`[${label}] Console 错误：${text}`);
  });
  page.on('requestfailed', (request) => {
    failures.push(`[${label}] 请求失败：${request.url()} ${request.failure()?.errorText || ''}`);
  });
}

async function openPage(browser, label, urlPath, waitFor) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  attachErrorCollector(page, label);
  await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: 'networkidle2', timeout: 25_000 });
  if (waitFor) {
    await page.waitForSelector(waitFor, { timeout: 12_000 });
  }
  await fs.mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${label}.png`), fullPage: true });
  console.log(`✓ ${label}`);
  return page;
}

async function loginUser(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  attachErrorCollector(page, 'login-user');
  await page.goto(`${BASE_URL}/login.html`, { waitUntil: 'networkidle2' });
  await page.type('#account', 'alice@mail.sysu.edu.cn');
  await page.type('#password', config.seedUserPassword);
  await Promise.all([
    page.waitForFunction(() => location.pathname.endsWith('/index.html'), { timeout: 12_000 }),
    page.click('#login-btn'),
  ]);
  await page.waitForSelector('#auth-links .auth-me', { timeout: 12_000 });
  console.log('✓ 学生登录');
  await page.close();
}

async function loginAdmin(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  attachErrorCollector(page, 'login-admin');
  await page.goto(`${BASE_URL}/admin-login.html`, { waitUntil: 'networkidle2' });

  const passwords = [
    process.env.SMOKE_ADMIN_PASSWORD,
    'Admin@2027',
    config.adminSeed.password,
  ].filter(Boolean);

  let stage = null;
  for (const password of passwords) {
    await page.select('#school', '1');
    await page.evaluate(({ username, pwd }) => {
      document.querySelector('#username').value = username;
      document.querySelector('#password').value = pwd;
      const errorBox = document.querySelector('#login-error');
      errorBox.hidden = true;
      errorBox.textContent = '';
    }, { username: config.adminSeed.username, pwd: password });
    await page.click('#admin-login-btn');

    // 等页面真正切换：成功会显示 setup/totp，失败会显示错误框
    await page.waitForFunction(
      () => !document.querySelector('#stage-setup').hidden
        || !document.querySelector('#stage-totp').hidden
        || !document.querySelector('#login-error').hidden,
      { timeout: 12_000 },
    );
    stage = await page.evaluate(() => {
      if (!document.querySelector('#stage-setup').hidden) return 'setup';
      if (!document.querySelector('#stage-totp').hidden) return 'totp';
      return 'error';
    });
    if (stage !== 'error') break;
  }

  if (stage === 'setup') {
    await page.waitForSelector('#setup-qr[src^="data:image"]', { timeout: 12_000 });
    await page.type('#new-password', 'Admin@2027');
    await page.type('#confirm-password', 'Admin@2027');
    await page.type('#setup-code', await getAdminTotp());
    await page.click('#setup-btn');
    await page.waitForSelector('#stage-done:not([hidden])', { timeout: 12_000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20_000 }),
      page.click('#enter-console'),
    ]);
  } else if (stage === 'totp') {
    await page.type('#totp-code', await getAdminTotp());
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20_000 }),
      page.click('#totp-btn'),
    ]);
  } else {
    throw new Error('管理员登录失败：密码不正确');
  }

  await page.waitForSelector('.kpis', { timeout: 15_000 });
  console.log('✓ 管理员登录与工作台');
  return page;
}

async function main() {
  const executablePath = await findBrowser();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    // 游客可读页面
    await openPage(browser, 'home', '/index.html', '#home-apps .path');
    await openPage(browser, 'app-center', '/app-center.html', '#app-grid .app');
    await openPage(browser, 'app-detail', '/app-detail.html?id=1', '#app-steps li');
    await openPage(browser, 'exam-lib', '/exam-lib.html', '#exam-list .exam');
    await openPage(browser, 'community', '/community.html', '#community-feed .postcard');
    await openPage(browser, 'register', '/register.html', '#school option');
    await openPage(browser, 'forgot-password', '/forgot-password.html', '#school option');
    await openPage(browser, 'guest-gate', '/guest-gate.html', 'h1');

    // 学生登录后的页面
    await loginUser(browser);
    await openPage(browser, 'profile', '/profile.html', '#my-exams-list');
    await openPage(browser, 'exam-upload', '/exam-upload.html', '#upload-form');
    await openPage(browser, 'exam-qa', '/exam-qa.html?id=1', '#qa-doc-title');

    // 管理端
    const adminPage = await loginAdmin(browser);
    const shot = await adminPage.evaluate(() => document.querySelector('.kpis')?.innerText || '');
    console.log(`  管理端 KPI：${shot.replace(/\n+/g, ' | ').slice(0, 120)}`);
    await adminPage.click('.side a[data-tab="registrations"]');
    await adminPage.waitForFunction(
      () => document.querySelector('.side a[data-tab="registrations"]').classList.contains('on')
        && document.querySelector('#admin-main .panel'),
      { timeout: 12_000 },
    );
    await adminPage.screenshot({ path: path.join(SHOT_DIR, 'admin-registrations.png'), fullPage: true });
    await adminPage.click('.side a[data-tab="security"]');
    await adminPage.waitForSelector('#admin-main .admin-form-field', { timeout: 12_000 });
    await adminPage.screenshot({ path: path.join(SHOT_DIR, 'admin-security.png'), fullPage: true });
    console.log('✓ 管理端标签页');
  } finally {
    await browser.close();
    await pool.end();
  }

  if (failures.length) {
    console.error('\n冒烟失败：');
    for (const failure of failures) console.error(` - ${failure}`);
    process.exit(1);
  }
  console.log('\n全部页面通过冒烟检查，截图在 server/screenshots/');
}

main().catch(async (error) => {
  console.error('冒烟脚本失败：', error);
  await pool.end().catch(() => {});
  process.exit(1);
});
