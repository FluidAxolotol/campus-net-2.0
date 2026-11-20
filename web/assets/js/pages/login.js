// ============================================================
// 登录表单：preventDefault → 校验 → 请求 → 错误映射 → 跳转
// ============================================================

import { api } from '../api.js';
import { safeNext, getMe } from '../auth.js';
import {
  el, showError, clearMessage, setBusy, toast,
} from '../ui.js';

const form = document.querySelector('#login-form');
const errorBox = document.querySelector('#login-error');
const button = document.querySelector('#login-btn');

async function main() {
  // 已经登录就直接回首页，避免重复登录
  const me = await getMe();
  if (me) {
    location.replace(safeNext('index.html'));
    return;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(errorBox);

  const account = document.querySelector('#account').value.trim();
  const password = document.querySelector('#password').value;
  const rememberMe = document.querySelector('#remember-me').checked;

  if (!account) return showError(errorBox, { message: '请输入学号或校园邮箱', code: 'VALIDATION_FAILED' });
  if (!password) return showError(errorBox, { message: '请输入密码', code: 'VALIDATION_FAILED' });

  const restore = setBusy(button, true, '登录中…');
  try {
    const data = await api.post('/api/auth/login', { account, password, rememberMe });
    toast(`欢迎回来，${data.user.displayName}`, 'success');
    setTimeout(() => {
      location.href = safeNext('index.html');
    }, 350);
  } catch (error) {
    if (error.code === 'USER_PENDING') {
      showError(errorBox, {
        code: 'USER_PENDING',
        message: '账号正在等待管理员审核，审核通过后即可登录',
      });
    } else if (error.code === 'USER_REJECTED' && error.details?.reason) {
      errorBox.textContent = `注册申请已被驳回：${error.details.reason}`;
      errorBox.hidden = false;
    } else {
      showError(errorBox, error);
    }
  } finally {
    restore();
  }
});

main();
