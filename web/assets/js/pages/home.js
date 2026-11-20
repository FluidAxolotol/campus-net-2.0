// ============================================================
// 首页：一次请求拿三块数据，再分别渲染
// 每一步都处理空数组与错误，页面不会白屏。
// ============================================================

import { api } from '../api.js';
import { mountSiteNav, currentSchoolId, onSchoolChange, getCachedMe, showLoginRequired } from '../auth.js';
import {
  el, mount, timeAgo, toast, emptyState, errorText,
} from '../ui.js';

const boardClass = {
  secondhand: 't-2nd',
  lost: 't-lost',
  study: 't-study',
  club: 't-club',
  carpool: 't-carpool',
  treehole: 't-hole',
};

function renderApps(container, apps, schoolName) {
  if (!apps.length) {
    mount(container, emptyState('这所学校还没有上架小工具'));
    return;
  }
  mount(container, apps.map((app) => el(
    'a',
    { class: 'path', href: `app-detail.html?id=${app.id}` },
    el('div', {},
      el('b', {}, app.title),
      el('span', { class: 'views' }, `👁 ${app.views} · ${app.summary}`)),
    el('span', { class: 'badge' }, app.category || schoolName),
  )));
}

function renderExams(container, exams, me) {
  if (!exams.length) {
    mount(container, emptyState('还没有审核通过的真题，欢迎上传第一份'));
    return;
  }
  mount(container, exams.map((exam) => {
    const download = el('span', {
      class: 'dl',
      role: 'button',
      tabindex: 0,
      onclick: async () => {
        if (!me) return showLoginRequired('下载真题需要先登录');
        try {
          await api.download(exam.downloadUrl, `${exam.title}.pdf`);
          toast('已开始下载', 'success');
        } catch (error) {
          if (error.status === 401) return showLoginRequired('登录已过期，请重新登录');
          toast(errorText(error), 'error');
        }
      },
    }, '⬇');

    return el('div', { class: 'exam' },
      el('div', {},
        el('b', {}, exam.title),
        el('span', { class: 'meta' },
          `${exam.semester} · ${exam.examType} · ${exam.file?.fileType || '文件'} · ${exam.downloadCount} 次下载`)),
      download);
  }));
}

function renderPosts(container, posts) {
  if (!posts.length) {
    mount(container, emptyState('社区还没有帖子，登录后发第一条吧'));
    return;
  }
  mount(container, posts.map((post) => el(
    'a',
    { class: 'post', href: 'community.html' },
    el('span', { class: `tag ${boardClass[post.board.code] || 't-hole'}` }, post.board.name),
    el('div', {},
      el('b', {}, post.title),
      el('span', { class: 'meta' },
        `${post.author.displayName} · ${timeAgo(post.createdAt)} · 👍 ${post.likeCount}`)),
  )));
}

async function loadHome() {
  const me = getCachedMe();
  const schoolId = await currentSchoolId();
  const query = schoolId ? `?schoolId=${schoolId}` : '';

  try {
    const data = await api.get(`/api/home${query}`);
    const schoolName = data.school.name;

    document.querySelector('#hero-sub').textContent =
      `小工具、真题、同学圈——都在校内网 2.0 · 🏫 ${schoolName}`;
    document.querySelector('#home-app-sub').textContent = `学生自制小工具集散地 · 当前：${schoolName}`;
    document.querySelector('#home-exam-sub').textContent =
      `一届帮一届 · 本校 ${data.stats.exams} 份真题已通过审核`;
    document.querySelector('#home-post-sub').textContent =
      `二手 · 失物 · 学习 · 拼车 · ${data.stats.posts} 条帖子`;
    document.querySelector('#home-notice').textContent =
      `📢 ${schoolName} 已有 ${data.stats.apps} 个工具、${data.stats.exams} 份真题、${data.stats.posts} 条社区内容；登录后即可上传、下载与发帖。`;

    renderApps(document.querySelector('#home-apps'), data.apps, schoolName);
    renderExams(document.querySelector('#home-exams'), data.exams, me);
    renderPosts(document.querySelector('#home-posts'), data.posts);
  } catch (error) {
    const message = errorText(error);
    for (const selector of ['#home-apps', '#home-exams', '#home-posts']) {
      mount(document.querySelector(selector), emptyState(message));
    }
  }
}

async function main() {
  await mountSiteNav();
  await loadHome();
  onSchoolChange(loadHome);

  const search = document.querySelector('.search input');
  if (search) {
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && search.value.trim()) {
        location.href = `app-center.html?q=${encodeURIComponent(search.value.trim())}`;
      }
    });
  }

  document.querySelector('.hero .chat button')?.addEventListener('click', () => {
    toast('首页提问入口已保留；演示版可去真题库按科目检索', 'info');
  });
}

main();
