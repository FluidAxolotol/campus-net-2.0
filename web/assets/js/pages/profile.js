// ============================================================
// 个人中心：资料、改密、我的真题、我的帖子
// 先 requireLogin，再做所有请求；页面不缓存 token。
// ============================================================

import { api } from '../api.js';
import { mountSiteNav, requireLogin } from '../auth.js';
import {
  el, mount, formatDate, timeAgo, toast, errorText,
  showError, clearMessage, setBusy, emptyState, statusLabels, statusClass,
} from '../ui.js';

const boardClass = {
  secondhand: 't-2nd',
  lost: 't-lost',
  study: 't-study',
  club: 't-club',
  carpool: 't-carpool',
  treehole: 't-hole',
};

let statsEls = {};

function setMessage(container, text, type = 'success') {
  container.textContent = text;
  container.hidden = false;
  container.className = `form-message form-message-${type}`;
}

function renderExams(exams) {
  const container = document.querySelector('#my-exams-list');
  if (!exams.length) {
    mount(container, emptyState('还没有上传过真题'));
    return;
  }
  mount(container, exams.map((exam) => {
    const download = el('button', {
      type: 'button',
      class: 'text-btn',
      onclick: async () => {
        try {
          await api.download(exam.downloadUrl, `${exam.title}.pdf`);
        } catch (error) {
          toast(errorText(error), 'error');
        }
      },
    }, '下载');

    return el('article', { class: 'myitem' },
      el('div', { class: 'file' }, exam.file?.fileType || 'PDF'),
      el('div', { class: 't' },
        el('b', {}, exam.title),
        el('span', { class: 'meta' },
          `${exam.semester} ${exam.examType} · 上传于 ${formatDate(exam.createdAt)} · 下载 ${exam.downloadCount} 次`),
        exam.reviewNote ? el('span', { class: 'meta', style: 'color:var(--danger);' }, `驳回原因：${exam.reviewNote}`) : null),
      el('span', { class: `st st-${statusClass(exam.status)}` }, statusLabels(exam.status)),
      download);
  }));
}

function renderPosts(posts) {
  const container = document.querySelector('#my-posts-list');
  if (!posts.length) {
    mount(container, emptyState('还没有发过帖子'));
    return;
  }
  mount(container, posts.map((post) => el(
    'article',
    { class: 'postmini' },
    el('div', {},
      el('b', {}, post.title),
      ' ',
      el('span', { class: `tag ${boardClass[post.board.code] || 't-hole'}` }, post.board.name),
      el('div', { class: 'meta' },
        `${timeAgo(post.createdAt)} · 💬 ${post.commentCount} · 👍 ${post.likeCount} · ${statusLabels(post.status)}`)),
    el('a', { class: 'op', href: 'community.html', style: 'text-decoration:none;' }, '查看 ›'),
  )));
}

async function loadProfile() {
  const data = await api.get('/api/profile');
  const user = data.user;

  document.title = `${user.displayName} · 个人中心`;
  document.querySelector('#profile-nick').textContent = user.displayName;
  document.querySelector('#profile-meta').replaceChildren(
    `🏫 ${user.school.name} · ${user.degree} · ${user.enrollYear} 级`,
    el('br'),
    user.college || '未填写学院',
  );

  statsEls.uploads.textContent = String(data.stats.uploads);
  statsEls.posts.textContent = String(data.stats.posts);
  statsEls.likes.textContent = String(data.stats.likesReceived);

  document.querySelector('#nickname').value = user.displayName || '';
  const schoolSelect = document.querySelector('#school');
  schoolSelect.replaceChildren(el('option', {}, user.school.name));
  schoolSelect.value = user.school.name;

  const degreeSelect = document.querySelector('#degree');
  degreeSelect.value = user.degree;
  if (!degreeSelect.value) {
    degreeSelect.append(el('option', {}, user.degree));
    degreeSelect.value = user.degree;
  }
  const enrollSelect = document.querySelector('#enroll');
  enrollSelect.value = String(user.enrollYear);
  if (!enrollSelect.value) {
    enrollSelect.append(el('option', {}, String(user.enrollYear)));
    enrollSelect.value = String(user.enrollYear);
  }

  document.querySelector('#student-id').value = user.studentNo;
  document.querySelector('#campus-email').value = user.email;
  document.querySelector('#college').value = user.college || '';
  document.querySelector('#bio').value = user.bio || '';

  renderExams(data.exams);
  renderPosts(data.posts);
}

async function main() {
  await mountSiteNav();
  const me = await requireLogin('profile.html');
  if (!me) return;

  statsEls = {
    uploads: document.querySelector('#stat-uploads'),
    posts: document.querySelector('#stat-posts'),
    likes: document.querySelector('#stat-likes'),
  };

  try {
    await loadProfile();
  } catch (error) {
    toast(errorText(error), 'error');
    if (error.status === 401) location.href = 'login.html?next=profile.html';
  }

  const profileForm = document.querySelector('#profile-form');
  const profileMessage = document.querySelector('#profile-message');
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(profileMessage);

    const displayName = document.querySelector('#nickname').value.trim();
    const college = document.querySelector('#college').value.trim();
    const bio = document.querySelector('#bio').value.trim();
    if (!displayName) {
      setMessage(profileMessage, '昵称不能为空', 'error');
      return;
    }

    const button = document.querySelector('#save-profile');
    const restore = setBusy(button, true, '保存中…');
    try {
      const data = await api.patch('/api/profile', { displayName, college, bio });
      document.querySelector('#profile-nick').textContent = data.user.displayName;
      setMessage(profileMessage, data.message);
      toast('资料已保存', 'success');
    } catch (error) {
      setMessage(profileMessage, errorText(error), 'error');
    } finally {
      restore();
    }
  });

  const passwordForm = document.querySelector('#password-form');
  const passwordMessage = document.querySelector('#password-message');
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(passwordMessage);

    const currentPassword = document.querySelector('#current-password').value;
    const newPassword = document.querySelector('#new-password').value;
    const confirmPassword = document.querySelector('#confirm-new-password').value;
    if (!currentPassword) {
      setMessage(passwordMessage, '请输入当前密码', 'error');
      return;
    }
    if (newPassword.length < 8) {
      setMessage(passwordMessage, '新密码至少 8 位', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage(passwordMessage, '两次输入的新密码不一致', 'error');
      return;
    }

    const button = document.querySelector('#change-password');
    const restore = setBusy(button, true, '更新中…');
    try {
      const data = await api.post('/api/profile/password', { currentPassword, newPassword });
      passwordForm.reset();
      setMessage(passwordMessage, data.message);
      toast('密码已更新', 'success');
    } catch (error) {
      showError(passwordMessage, error);
    } finally {
      restore();
    }
  });
}

main();
