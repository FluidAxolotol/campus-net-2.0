// ============================================================
// 找回密码：提交申请给管理员（课程 P0 不接邮件服务）
// 为避免枚举账号，无论账号是否存在都返回同样的成功提示。
// ============================================================

import { api } from '../api.js';
import {
  el, showError, clearMessage, setBusy,
} from '../ui.js';

const form = document.querySelector('#reset-form');
const schoolSelect = document.querySelector('#school');
const errorBox = document.querySelector('#reset-error');
const successBox = document.querySelector('#reset-success');
const button = document.querySelector('#reset-btn');

async function loadSchools() {
  try {
    const schools = await api.get('/api/schools');
    schoolSelect.replaceChildren();
    for (const school of schools) {
      schoolSelect.append(el('option', { value: String(school.id) }, school.name));
    }
  } catch {
    schoolSelect.replaceChildren(el('option', { value: '' }, '学校列表加载失败'));
    button.disabled = true;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(errorBox);
  clearMessage(successBox);

  const schoolId = Number(schoolSelect.value);
  const account = document.querySelector('#account').value.trim();
  const note = document.querySelector('#note').value.trim();

  if (!schoolId) return showError(errorBox, { message: '请选择学校', code: 'VALIDATION_FAILED' });
  if (!account) return showError(errorBox, { message: '请输入学号或校园邮箱', code: 'VALIDATION_FAILED' });

  const restore = setBusy(button, true, '提交中…');
  try {
    const data = await api.post('/api/auth/password-reset-request', { schoolId, account, note });
    successBox.textContent = data.message;
    successBox.hidden = false;
    form.reset();
  } catch (error) {
    showError(errorBox, error);
  } finally {
    restore();
  }
});

loadSchools();
