// ============================================================
// 应用中心：学校隔离 + 分类/搜索 + 卡片渲染
// ============================================================

import { api } from '../api.js';
import {
  mountSiteNav, currentSchool, currentSchoolId, onSchoolChange, getQuery,
} from '../auth.js';
import {
  el, mount, emptyState, errorText,
} from '../ui.js';

const state = {
  category: '全部',
  q: getQuery('q') || '',
};

const iconClass = {
  企微导航: 'ico-nav',
  寻搭子: 'ico-team',
  学习: 'ico-study',
  生活: 'ico-life',
  效率: 'ico-teal',
};

const tagClass = {
  企微导航: 'tg-nav',
  寻搭子: 'tg-team',
  学习: 'tg-study',
  生活: 'tg-life',
  效率: 'tg-algo',
};

function renderApps(apps) {
  const grid = document.querySelector('#app-grid');
  if (!apps.length) {
    mount(grid, emptyState('没有找到符合条件的工具，换个关键词试试'));
    grid.firstElementChild.style.gridColumn = '1 / -1';
    return;
  }
  mount(grid, apps.map((app) => el(
    'a',
    { class: 'app-link', href: `app-detail.html?id=${app.id}` },
    el('article', { class: 'app' },
      el('div', { class: `ico ${iconClass[app.category] || 'ico-muted'}` }, app.icon || '🧰'),
      el('h3', {}, app.title),
      el('p', {}, app.summary),
      el('div', { class: 'tagrow' },
        el('span', { class: `tg ${tagClass[app.category] || 'tg-algo'}` }, app.category),
        el('span', { class: 'views' }, `👁 ${app.views}`))),
  )));
}

async function loadApps() {
  const school = await currentSchool();
  document.querySelector('#current-school-label').textContent = school?.name || '未选择';
  const schoolId = await currentSchoolId();
  if (!schoolId) {
    mount(document.querySelector('#app-grid'), emptyState('请先选择学校'));
    return;
  }

  const params = new URLSearchParams({
    schoolId: String(schoolId),
    pageSize: '50',
  });
  if (state.category && state.category !== '全部') params.set('category', state.category);
  if (state.q) params.set('q', state.q);

  mount(document.querySelector('#app-grid'), emptyState('正在加载工具…'));
  try {
    const result = await api.getRaw(`/api/apps?${params.toString()}`);
    renderApps(result.data);
  } catch (error) {
    mount(document.querySelector('#app-grid'), emptyState(errorText(error)));
  }
}

function setCategory(category) {
  state.category = category;
  document.querySelectorAll('#app-cats .cat').forEach((button) => {
    button.classList.toggle('on', button.dataset.category === category);
  });
  loadApps();
}

async function main() {
  await mountSiteNav();
  const input = document.querySelector('#app-search');
  input.value = state.q;

  document.querySelector('#app-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.q = input.value.trim();
    loadApps();
  });

  document.querySelectorAll('#app-cats .cat').forEach((button) => {
    button.addEventListener('click', () => setCategory(button.dataset.category));
  });

  onSchoolChange(loadApps);
  await loadApps();
}

main();
