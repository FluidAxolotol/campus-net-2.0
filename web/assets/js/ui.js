// ============================================================
// 通用 UI 工具
// 重点：渲染用户数据时只用 textContent / createElement，不拼 innerHTML。
// ============================================================

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // 只用于本文件里的可信模板
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node) node[key] = value;
    else node.setAttribute(key, String(value));
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function mount(parent, ...children) {
  if (!parent) return;
  parent.replaceChildren();
  appendChildren(parent, children);
}

export function timeAgo(value) {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
}

export function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = el('div', { class: 'toast-container' });
    document.body.append(container);
  }
  const item = el('div', { class: `toast toast-${type}`, role: 'status' }, message);
  container.append(item);
  setTimeout(() => item.classList.add('toast-out'), 2600);
  setTimeout(() => item.remove(), 3200);
}

const ERROR_TEXT = {
  UNAUTHENTICATED: '请先登录',
  AUTH_INVALID: '账号或密码错误',
  USER_PENDING: '账号还在等待管理员审核',
  USER_REJECTED: '注册申请已被驳回',
  USER_DISABLED: '账号已被停用',
  USER_LOCKED: '密码错误次数过多，请 15 分钟后再试',
  SCHOOL_DISABLED: '所属学校已停用',
  AMBIGUOUS_ACCOUNT: '该学号在多个学校存在，请改用校园邮箱登录',
  EMAIL_EXISTS: '这个邮箱已经注册过了',
  STUDENT_NO_EXISTS: '这个学号在本校已经注册过了',
  EMAIL_DOMAIN_INVALID: '请使用本校校园邮箱',
  CSRF_INVALID: '页面令牌已过期，请刷新后重试',
  RATE_LIMITED: '操作太频繁，请稍后再试',
  ADMIN_INVALID: '管理员账号或密码错误',
  ADMIN_LOCKED: '管理员密码错误次数过多，请稍后再试',
  ADMIN_STAGE_REQUIRED: '当前登录阶段不允许该操作',
  TOTP_INVALID: '动态码不正确或已过期',
  TOTP_REPLAY: '这个动态码已经用过，请等下一个',
  RECOVERY_INVALID: '恢复码无效或已经使用过',
  VALIDATION_FAILED: '请检查填写内容',
  FILE_TOO_LARGE: '文件超过 20MB 限制',
  FILE_TYPE_INVALID: '只支持 PDF / JPG / PNG',
  EXAM_ALREADY_REVIEWED: '这条真题已经审核过了',
  FORBIDDEN: '没有权限',
  NOT_FOUND: '资源不存在',
};

export function errorText(error) {
  if (!error) return '操作失败';
  if (ERROR_TEXT[error.code]) {
    if (error.code === 'USER_REJECTED' && error.details?.reason) {
      return `${ERROR_TEXT[error.code]}：${error.details.reason}`;
    }
    if (error.code === 'VALIDATION_FAILED' && error.details) {
      const first = Object.values(error.details)[0];
      if (first) return first;
    }
    return ERROR_TEXT[error.code];
  }
  return error.message || '操作失败';
}

export function showError(container, error) {
  if (!container) return;
  mount(container, '');
  container.textContent = errorText(error);
  container.hidden = false;
  container.classList.add('form-message', 'form-message-error');
}

export function clearMessage(container) {
  if (!container) return;
  container.textContent = '';
  container.hidden = true;
}

export function setBusy(button, busy, busyText = '处理中…') {
  if (!button) return () => {};
  const originalText = button.textContent;
  if (busy) {
    button.disabled = true;
    button.dataset.originalText = originalText;
    button.textContent = busyText;
    button.classList.add('is-busy');
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || originalText;
    button.classList.remove('is-busy');
  }
  return () => setBusy(button, false);
}

export function statusLabels(status) {
  return {
    pending: '待审核',
    approved: '已通过',
    rejected: '已驳回',
    active: '正常',
    disabled: '已停用',
    published: '已发布',
    hidden: '已隐藏',
    deleted: '已删除',
    open: '待处理',
    resolved: '已修复',
    ignored: '已忽略',
    done: '已完成',
  }[status] || status;
}

export function statusClass(status) {
  if (['approved', 'active', 'published', 'resolved', 'done'].includes(status)) return 'ok';
  if (['pending', 'open'].includes(status)) return 'wait';
  if (['rejected', 'disabled', 'hidden', 'deleted'].includes(status)) return 'danger';
  return 'muted';
}

/**
 * 通用弹窗：用于发帖、驳回原因、改状态等。
 * fields: [{ name, label, type: 'text'|'textarea', value, placeholder }]
 */
export function openDialog({ title, message = '', fields = [], confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = el('div', { class: 'dialog-mask' });
    const inputs = new Map();

    const card = el('div', { class: 'dialog-card', role: 'dialog', 'aria-modal': 'true' });
    card.append(el('h3', { class: 'dialog-title' }, title));

    if (message) card.append(el('p', { class: 'dialog-message' }, message));

    for (const field of fields) {
      const id = `dlg-${field.name}-${Math.random().toString(36).slice(2, 7)}`;
      let input;
      if (field.type === 'textarea') {
        input = el('textarea', { id, class: 'dialog-input', rows: 4, placeholder: field.placeholder || '' });
      } else if (field.type === 'select') {
        input = el('select', { id, class: 'dialog-input' });
        for (const [value, label] of field.options || []) {
          input.append(el('option', { value: String(value) }, label));
        }
      } else {
        input = el('input', { id, class: 'dialog-input', type: field.type || 'text', placeholder: field.placeholder || '' });
      }
      input.value = field.value ?? '';
      inputs.set(field.name, input);
      card.append(el('label', { class: 'dialog-field', for: id }, el('span', {}, field.label), input));
    }

    const close = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      resolve(result);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') close(null);
    };

    const cancel = el('button', { type: 'button', class: 'dialog-btn ghost', onclick: () => close(null) }, cancelText);
    const confirm = el('button', {
      type: 'button',
      class: `dialog-btn ${danger ? 'danger' : 'primary'}`,
      onclick: () => {
        const values = {};
        for (const [name, input] of inputs) values[name] = input.value.trim();
        close(values);
      },
    }, confirmText);

    card.append(el('div', { class: 'dialog-actions' }, cancel, confirm));
    overlay.append(card);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    document.body.append(overlay);
    document.addEventListener('keydown', onKeyDown);
    const firstInput = card.querySelector('input, textarea');
    (firstInput || confirm).focus();
  });
}

export function confirmDialog({ title, message, confirmText = '确定', danger = true }) {
  return openDialog({ title, message, fields: [], confirmText, danger })
    .then((value) => Boolean(value));
}

export function emptyState(text) {
  return el('div', { class: 'empty-state' }, text);
}
