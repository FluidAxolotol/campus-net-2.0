// ============================================================
// 管理员登录状态机
// 密码 → 首次绑定（改密 + TOTP）/ 日常动态码 → 恢复码 → active
// 页面切换由后端返回的 stage 驱动，不在前端猜。
// ============================================================

import { api } from '../api.js';
import {
  el, showError, clearMessage, setBusy, toast, openDialog,
} from '../ui.js';

const ADMIN_SCHOOL_KEY = 'campus_admin_school_id';
const stages = ['credentials', 'setup', 'totp', 'recovery', 'done'];
let schools = [];

function showStage(name) {
  for (const stage of stages) {
    document.querySelector(`#stage-${stage}`).hidden = stage !== name;
  }
}

async function loadSchools() {
  const select = document.querySelector('#school');
  try {
    schools = await api.get('/api/schools');
    select.replaceChildren();
    for (const school of schools) {
      select.append(el('option', { value: String(school.id) }, school.name));
    }
    const remembered = Number(localStorage.getItem(ADMIN_SCHOOL_KEY));
    if (schools.some((school) => school.id === remembered)) {
      select.value = String(remembered);
    }
  } catch {
    select.replaceChildren(el('option', { value: '' }, '学校列表加载失败'));
  }
}

async function enterSetup(message = '') {
  showStage('setup');
  const setupSub = document.querySelector('#setup-sub');
  setupSub.textContent = message || '请用微信「腾讯身份验证器」小程序扫描二维码，然后设置新密码并输入 6 位动态码。';
  try {
    const data = await api.get('/api/admin/auth/setup');
    const img = document.querySelector('#setup-qr');
    img.src = data.qrDataUrl;
    img.alt = `绑定二维码：${data.account}`;
    document.querySelector('#setup-account').textContent = data.account;
    document.querySelector('#setup-secret').textContent = data.secret;
    setupSub.textContent = `${data.hint}。当前学校：${data.school.name}。`;
  } catch (error) {
    showError(document.querySelector('#setup-error'), error);
  }
}

function enterTotp(schoolName = '') {
  showStage('totp');
  if (schoolName) {
    document.querySelector('#totp-sub').textContent =
      `正在管理：${schoolName}。打开腾讯身份验证器，输入当前 6 位数字。`;
  }
}

function showRecoveryCodes(codes) {
  showStage('done');
  const container = document.querySelector('#recovery-codes');
  container.replaceChildren(...codes.map((code) => el('span', {}, code)));

  document.querySelector('#copy-recovery').onclick = async () => {
    const text = codes.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('恢复码已复制，请离线保存', 'success');
    } catch {
      await openDialog({
        title: '手动复制恢复码',
        message: '浏览器不允许自动复制。请选中下面的内容复制。',
        fields: [{ name: 'codes', label: '恢复码', type: 'textarea', value: text }],
        confirmText: '知道了',
      });
    }
  };

  document.querySelector('#enter-console').onclick = () => {
    location.href = 'admin-console.html';
  };
}

async function resumeSession() {
  try {
    const data = await api.get('/api/admin/auth/me');
    if (data.stage === 'active') {
      location.replace('admin-console.html');
      return;
    }
    if (data.stage === 'setup_required') {
      await enterSetup();
      return;
    }
    if (data.stage === 'totp_required') {
      enterTotp(data.school?.name || '');
      return;
    }
  } catch {
    // 没有管理员会话：停在账号密码阶段
  }
  showStage('credentials');
}

// ---------------- 阶段 1 ----------------
document.querySelector('#admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector('#login-error');
  clearMessage(errorBox);

  const schoolId = Number(document.querySelector('#school').value);
  const username = document.querySelector('#username').value.trim();
  const password = document.querySelector('#password').value;
  if (!schoolId) return showError(errorBox, { message: '请选择学校', code: 'VALIDATION_FAILED' });
  if (!username) return showError(errorBox, { message: '请输入管理员账号', code: 'VALIDATION_FAILED' });
  if (!password) return showError(errorBox, { message: '请输入密码', code: 'VALIDATION_FAILED' });

  const button = document.querySelector('#admin-login-btn');
  const restore = setBusy(button, true, '验证中…');
  try {
    localStorage.setItem(ADMIN_SCHOOL_KEY, String(schoolId));
    const data = await api.post('/api/admin/auth/login', { schoolId, username, password });
    if (data.stage === 'setup_required') {
      await enterSetup();
    } else {
      enterTotp(data.school?.name || '');
    }
  } catch (error) {
    showError(errorBox, error);
  } finally {
    restore();
  }
});

// ---------------- 阶段 2：首次绑定 ----------------
document.querySelector('#setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector('#setup-error');
  clearMessage(errorBox);

  const newPassword = document.querySelector('#new-password').value;
  const confirmPassword = document.querySelector('#confirm-password').value;
  const code = document.querySelector('#setup-code').value.trim();

  if (newPassword.length < 8) {
    return showError(errorBox, { message: '新密码至少 8 位', code: 'VALIDATION_FAILED' });
  }
  if (newPassword !== confirmPassword) {
    return showError(errorBox, { message: '两次输入的新密码不一致', code: 'VALIDATION_FAILED' });
  }
  if (!/^\d{6}$/.test(code)) {
    return showError(errorBox, { message: '请输入 6 位动态码', code: 'VALIDATION_FAILED' });
  }

  const button = document.querySelector('#setup-btn');
  const restore = setBusy(button, true, '绑定中…');
  try {
    const data = await api.post('/api/admin/auth/setup', { newPassword, code });
    showRecoveryCodes(data.recoveryCodes);
    toast('动态码绑定完成', 'success');
  } catch (error) {
    showError(errorBox, error);
  } finally {
    restore();
  }
});

document.querySelector('#setup-reset').onclick = async () => {
  await api.post('/api/admin/auth/logout').catch(() => {});
  showStage('credentials');
};

// ---------------- 阶段 3：日常动态码 ----------------
document.querySelector('#totp-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector('#totp-error');
  clearMessage(errorBox);
  const code = document.querySelector('#totp-code').value.trim();
  if (!/^\d{6}$/.test(code)) {
    return showError(errorBox, { message: '请输入 6 位动态码', code: 'VALIDATION_FAILED' });
  }

  const button = document.querySelector('#totp-btn');
  const restore = setBusy(button, true, '验证中…');
  try {
    await api.post('/api/admin/auth/verify', { code });
    location.href = 'admin-console.html';
  } catch (error) {
    if (error.code === 'ADMIN_SETUP_REQUIRED') {
      await enterSetup('请先完成动态码绑定。');
    } else {
      showError(errorBox, error);
    }
  } finally {
    restore();
  }
});

document.querySelector('#show-recovery').onclick = () => {
  clearMessage(document.querySelector('#recovery-error'));
  showStage('recovery');
};

document.querySelector('#totp-reset').onclick = async () => {
  await api.post('/api/admin/auth/logout').catch(() => {});
  showStage('credentials');
};

// ---------------- 阶段 4：恢复码 ----------------
document.querySelector('#recovery-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector('#recovery-error');
  clearMessage(errorBox);
  const code = document.querySelector('#recovery-code').value.trim();
  if (!code) return showError(errorBox, { message: '请输入恢复码', code: 'VALIDATION_FAILED' });

  const button = document.querySelector('#recovery-btn');
  const restore = setBusy(button, true, '验证中…');
  try {
    const data = await api.post('/api/admin/auth/recovery', { code });
    toast(data.message, 'success');
    await enterSetup('恢复码验证通过。请重新扫码绑定验证器，并设置新密码。');
  } catch (error) {
    showError(errorBox, error);
  } finally {
    restore();
  }
});

document.querySelector('#recovery-back').onclick = () => showStage('totp');

// ---------------- 启动 ----------------
loadSchools();
resumeSession();
