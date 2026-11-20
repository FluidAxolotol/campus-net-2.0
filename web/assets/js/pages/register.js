// ============================================================
// 注册：学校列表来自后端；提交后是 pending，不直接登录
// ============================================================

import { api } from '../api.js';
import {
  el, showError, clearMessage, setBusy, toast,
} from '../ui.js';

const form = document.querySelector('#register-form');
const schoolSelect = document.querySelector('#school');
const schoolHint = document.querySelector('#school-hint');
const emailHint = document.querySelector('#email-hint');
const errorBox = document.querySelector('#register-error');
const button = document.querySelector('#register-btn');

let schools = [];

function populateSchools() {
  schoolSelect.replaceChildren();
  for (const school of schools) {
    schoolSelect.append(el('option', { value: String(school.id) }, school.name));
  }
  if (!schools.length) {
    schoolSelect.append(el('option', { value: '' }, '暂无可用学校'));
    button.disabled = true;
  }
  updateHints();
}

function updateHints() {
  const school = schools.find((item) => String(item.id) === schoolSelect.value);
  if (!school) return;
  emailHint.textContent = `仅接受 @${school.emailDomain} 结尾的校园邮箱`;
}

async function loadSchools() {
  try {
    schools = await api.get('/api/schools');
    populateSchools();
  } catch (error) {
    schoolSelect.replaceChildren(el('option', { value: '' }, '学校列表加载失败'));
    button.disabled = true;
    toast('学校列表加载失败，请刷新重试', 'error');
  }
}

schoolSelect.addEventListener('change', updateHints);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(errorBox);

  const schoolId = Number(schoolSelect.value);
  const studentNo = document.querySelector('#student-id').value.trim();
  const email = document.querySelector('#campus-email').value.trim();
  const displayName = document.querySelector('#nickname').value.trim();
  const password = document.querySelector('#password').value;
  const confirmPassword = document.querySelector('#confirm-password').value;
  const degree = document.querySelector('#degree').value;
  const enrollYear = Number(document.querySelector('#enroll').value);
  const agree = document.querySelector('#agree').checked;

  if (!schoolId) return showError(errorBox, { message: '请选择学校', code: 'VALIDATION_FAILED' });
  if (!studentNo) return showError(errorBox, { message: '请填写学号', code: 'VALIDATION_FAILED' });
  if (!email) return showError(errorBox, { message: '请填写校园邮箱', code: 'VALIDATION_FAILED' });
  if (!displayName) return showError(errorBox, { message: '请填写昵称', code: 'VALIDATION_FAILED' });
  if (password !== confirmPassword) {
    return showError(errorBox, { message: '两次输入的密码不一致', code: 'VALIDATION_FAILED' });
  }
  if (!agree) return showError(errorBox, { message: '请先同意用户协议与隐私政策', code: 'VALIDATION_FAILED' });

  const restore = setBusy(button, true, '提交中…');
  try {
    const data = await api.post('/api/auth/register', {
      schoolId,
      studentNo,
      email,
      displayName,
      password,
      degree,
      enrollYear,
      college: '',
    });
    form.hidden = true;
    document.querySelector('#register-alt').hidden = true;
    const card = document.querySelector('.card');
    card.append(
      el('div', { class: 'form-message form-message-success', style: 'font-size:13px;line-height:1.8;' },
        el('b', {}, '✅ 注册申请已提交'),
        el('br'),
        `学校：${data.schoolName}`,
        el('br'),
        '当前状态：待审核。管理员通过后，你就可以用校园邮箱登录了。'),
      el('div', { class: 'alt' }, el('a', { href: 'login.html' }, '去登录页 ›')),
    );
    toast('注册申请已提交，等待管理员审核', 'success');
  } catch (error) {
    showError(errorBox, error);
  } finally {
    restore();
  }
});

loadSchools();
