// ============================================================
// 上传真题：前端只做体验检查，真正的安全边界在后端
// 文件用 XHR 上传，展示真实进度；提交后是 pending。
// ============================================================

import { api } from '../api.js';
import { mountSiteNav, requireLogin, showLoginRequired } from '../auth.js';
import {
  el, mount, showError, clearMessage, setBusy, toast,
} from '../ui.js';

let selectedFile = null;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function onFileChange(event) {
  clearMessage(document.querySelector('#upload-error'));
  clearMessage(document.querySelector('#upload-success'));
  const file = event.target.files?.[0] || null;
  selectedFile = file;
  const label = document.querySelector('#file-name');

  if (!file) {
    label.textContent = '尚未选择文件';
    return;
  }

  if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
    selectedFile = null;
    event.target.value = '';
    label.textContent = '文件类型不支持';
    toast('只支持 PDF / JPG / PNG', 'error');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    selectedFile = null;
    event.target.value = '';
    label.textContent = '文件超过 20MB';
    toast('文件超过 20MB', 'error');
    return;
  }
  label.textContent = `${file.name}（${formatSize(file.size)}）✓ 已选择`;
}

async function onSubmit(event) {
  event.preventDefault();
  const errorBox = document.querySelector('#upload-error');
  const successBox = document.querySelector('#upload-success');
  clearMessage(errorBox);
  clearMessage(successBox);

  const me = await requireLogin('exam-upload.html');
  if (!me) return;

  const title = document.querySelector('#title').value.trim();
  const subject = document.querySelector('#subject').value.trim();
  const college = document.querySelector('#college').value;
  const semester = document.querySelector('#semester').value;
  const examType = document.querySelector('#exam-type').value;
  const hasAnswer = document.querySelector('#has-answer').value;

  if (!selectedFile) return showError(errorBox, { message: '请选择文件', code: 'VALIDATION_FAILED' });
  if (title.length < 4) return showError(errorBox, { message: '标题至少 4 个字', code: 'VALIDATION_FAILED' });
  if (!subject) return showError(errorBox, { message: '请填写科目', code: 'VALIDATION_FAILED' });

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('title', title);
  formData.append('subject', subject);
  formData.append('college', college);
  formData.append('semester', semester);
  formData.append('examType', examType);
  formData.append('hasAnswer', hasAnswer);

  const button = document.querySelector('#upload-btn');
  const progressWrap = document.querySelector('#upload-progress-wrap');
  const bar = document.querySelector('#upload-progress-bar');
  const progressText = document.querySelector('#upload-progress-text');
  progressWrap.hidden = false;
  bar.style.width = '0%';
  progressText.textContent = '0%';

  const restore = setBusy(button, true, '上传中…');
  let succeeded = false;
  try {
    const data = await api.upload('/api/exams', formData, {
      onProgress: (percent) => {
        bar.style.width = `${percent}%`;
        progressText.textContent = `${percent}%`;
      },
    });
    succeeded = true;
    successBox.textContent = data.message;
    successBox.hidden = false;
    document.querySelector('#upload-form').querySelectorAll('input, select, button').forEach((node) => {
      node.disabled = true;
    });
    successBox.append(
      el('div', { style: 'margin-top:8px;' },
        el('a', { href: 'profile.html', style: 'color:#0F7A48;font-weight:600;' }, '去个人中心查看审核状态 ›')),
    );
    toast('已提交审核', 'success');
  } catch (error) {
    if (error.status === 401) return showLoginRequired('登录已过期，请重新登录');
    showError(errorBox, error);
  } finally {
    restore();
    if (succeeded) button.disabled = true;
  }
}

async function main() {
  await mountSiteNav();
  await requireLogin('exam-upload.html');
  document.querySelector('#file').addEventListener('change', onFileChange);
  document.querySelector('#upload-form').addEventListener('submit', onSubmit);
  document.querySelector('#upload-cancel').addEventListener('click', () => {
    location.href = 'exam-lib.html';
  });
  // 支持拖拽到虚线框
  const drop = document.querySelector('#drop-label');
  drop.addEventListener('dragover', (event) => event.preventDefault());
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const input = document.querySelector('#file');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    onFileChange({ target: input });
  });
}

main();
