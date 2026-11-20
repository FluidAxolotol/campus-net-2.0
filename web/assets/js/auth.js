// ============================================================
// 登录态与站点导航
// 不在 localStorage 里存用户信息或 token；
// 每次加载页面都问后端 /api/auth/me，后端才是唯一事实来源。
// ============================================================

import { api } from './api.js';
import { el, toast } from './ui.js';

const SCHOOL_KEY = 'campus_school_id';

let meCache = null;
let schoolsCache = null;
let selectedSchoolId = Number(localStorage.getItem(SCHOOL_KEY)) || null;

export function getQuery(name) {
  return new URLSearchParams(location.search).get(name);
}

export function safeNext(fallback = 'index.html') {
  const next = getQuery('next');
  if (!next) return fallback;
  // 只允许站内相对路径，防止开放重定向
  if (!/^[A-Za-z0-9._/?=&%-]+$/.test(next)) return fallback;
  if (next.startsWith('http') || next.startsWith('//')) return fallback;
  return next;
}

export async function loadSchools() {
  if (schoolsCache) return schoolsCache;
  const data = await api.get('/api/schools');
  schoolsCache = Array.isArray(data) ? data : [];
  return schoolsCache;
}

export async function getMe(force = false) {
  if (meCache && !force) return meCache;
  try {
    const data = await api.get('/api/auth/me');
    meCache = data.user;
    return meCache;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      meCache = null;
      return null;
    }
    throw error;
  }
}

export function getCachedMe() {
  return meCache;
}

export async function currentSchool() {
  const me = await getMe();
  if (me?.school) return me.school;
  const schools = await loadSchools();
  if (!selectedSchoolId || !schools.some((school) => school.id === selectedSchoolId)) {
    selectedSchoolId = schools[0]?.id ?? null;
    if (selectedSchoolId) localStorage.setItem(SCHOOL_KEY, String(selectedSchoolId));
  }
  return schools.find((school) => school.id === selectedSchoolId) || schools[0] || null;
}

export async function currentSchoolId() {
  const school = await currentSchool();
  return school?.id ?? null;
}

export function schoolQuery() {
  return selectedSchoolId ? `schoolId=${selectedSchoolId}` : '';
}

export function onSchoolChange(handler) {
  window.addEventListener('school:change', (event) => handler(event.detail.school));
}

export async function requireLogin(next = location.pathname + location.search) {
  const me = await getMe();
  if (!me) {
    location.replace(`login.html?next=${encodeURIComponent(next)}`);
    return null;
  }
  return me;
}

export async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    // 即使请求失败也回首页，Cookie 清理由服务端下次覆盖
  }
  meCache = null;
  location.href = 'index.html';
}

async function selectSchool(school) {
  selectedSchoolId = school.id;
  localStorage.setItem(SCHOOL_KEY, String(school.id));
  window.dispatchEvent(new CustomEvent('school:change', { detail: { school } }));
}

function ensureSchoolWidget(nav, me) {
  let root = nav.querySelector('.school');
  let button;

  if (!root) {
    root = el('div', { class: 'school-root' });
    nav.append(root);
  } else if (root.tagName === 'BUTTON') {
    // 原页面把整个 .school 做成按钮，给它套一个 relative 容器放菜单
    const wrapper = el('div', { class: 'school-root' });
    root.before(wrapper);
    wrapper.append(root);
    root = wrapper;
  } else {
    root.classList.add('school-root');
  }

  button = root.matches('button')
    ? root
    : root.querySelector('button');
  if (!button) {
    button = el('button', { type: 'button', class: 'cur' });
    root.append(button);
  }

  let menu = root.querySelector('.menu');
  if (!menu) {
    menu = el('div', { class: 'menu site-school-menu' });
    root.append(menu);
  } else {
    menu.classList.add('site-school-menu');
  }
  menu.replaceChildren();
  menu.hidden = true;

  if (me?.school) {
    button.textContent = `🏫 ${me.school.name} ▾`;
    button.title = '登录账号已绑定学校，如需切换请联系管理员';
    button.onclick = () => toast('登录账号已绑定学校，数据按学校隔离', 'info');
    return { root, button, menu };
  }

  const schools = schoolsCache || [];
  const current = schools.find((school) => school.id === selectedSchoolId) || schools[0];
  if (current && !selectedSchoolId) {
    selectedSchoolId = current.id;
    localStorage.setItem(SCHOOL_KEY, String(current.id));
  }
  button.textContent = current ? `🏫 ${current.name} ▾` : '🏫 选择学校 ▾';
  button.onclick = (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  };

  menu.append(el('div', { class: 'menu-title' }, '切换学校（游客浏览）'));
  for (const school of schools) {
    const option = el('button', {
      type: 'button',
      class: `menu-option${school.id === current?.id ? ' on' : ''}`,
      onclick: async () => {
        await selectSchool(school);
        button.textContent = `🏫 ${school.name} ▾`;
        menu.hidden = true;
        menu.querySelectorAll('.menu-option').forEach((node) => node.classList.remove('on'));
        option.classList.add('on');
        toast(`已切换到 ${school.name}`, 'success');
      },
    }, school.name, school.id === current?.id ? el('span', {}, '✓') : null);
    menu.append(option);
  }

  return { root, button, menu };
}

function ensureAuthLinks(nav) {
  let container = nav.querySelector('#auth-links');
  if (!container) {
    container = el('div', { class: 'auth-links', id: 'auth-links' });
    nav.append(container);
  }
  return container;
}

function renderAuthLinks(container, me) {
  if (me) {
    const name = el('a', { class: 'auth-me', href: 'profile.html' }, `👤 ${me.displayName}`);
    const button = el('button', {
      type: 'button',
      class: 'auth-link-btn',
      onclick: () => logout(),
    }, '退出');
    container.replaceChildren(name, button);
  } else {
    container.replaceChildren(
      el('a', { class: 'auth-register', href: 'register.html' }, '注册'),
      el('a', { class: 'auth-login', href: 'login.html' }, '登录'),
    );
  }
}

/**
 * 给普通前台页面挂上学校切换与登录入口。
 * 页面只需要在导航里放一个 .school（按钮或容器）即可。
 */
export async function mountSiteNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return null;

  let me = null;
  try {
    me = await getMe();
  } catch {
    me = null;
  }
  try {
    await loadSchools();
  } catch {
    // 学校列表失败时页面仍可显示，具体页面会提示错误
  }

  ensureSchoolWidget(nav, me);
  const authLinks = ensureAuthLinks(nav);
  renderAuthLinks(authLinks, me);

  // 点击页面其他区域时收起学校菜单
  document.addEventListener('click', (event) => {
    const menu = nav.querySelector('.site-school-menu');
    if (!menu) return;
    const root = menu.closest('.school-root') || menu.closest('.school');
    if (root && !root.contains(event.target)) menu.hidden = true;
  });

  return { me, school: await currentSchool() };
}

export function showLoginRequired(message = '这项操作需要登录') {
  toast(message, 'info');
  setTimeout(() => {
    location.href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
  }, 600);
}
