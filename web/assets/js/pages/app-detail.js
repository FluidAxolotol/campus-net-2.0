// ============================================================
// 办事入口详情：按 ?id= 加载本校的应用，并按数组渲染步骤
// ============================================================

import { api } from '../api.js';
import {
  mountSiteNav, currentSchoolId, getMe, showLoginRequired, getQuery,
} from '../auth.js';
import {
  el, mount, toast, errorText, openDialog,
} from '../ui.js';

const appId = Number(getQuery('id'));

function renderSteps(steps) {
  const list = document.querySelector('#app-steps');
  if (!Array.isArray(steps) || steps.length === 0) {
    list.replaceChildren(el('li', {}, el('div', {}, el('b', {}, '暂无步骤说明'))));
    return;
  }
  list.replaceChildren(...steps.map((step, index) => el(
    'li',
    {},
    el('span', { class: 'n', 'aria-hidden': 'true' }, String(index + 1)),
    el('div', {},
      el('b', {}, step.title),
      step.hint ? el('p', { class: 'hint' }, step.hint) : null),
  )));
}

async function loadApp() {
  if (!appId) {
    location.replace('app-center.html');
    return;
  }
  const schoolId = await currentSchoolId();
  try {
    const data = await api.get(`/api/apps/${appId}${schoolId ? `?schoolId=${schoolId}` : ''}`);
    const app = data.app;
    document.title = `${app.title} · 校内网 2.0`;
    document.querySelector('#crumb-title').textContent = app.title;
    document.querySelector('#crumb-category').textContent = app.category;
    document.querySelector('#app-icon').textContent = app.icon || '🧭';
    document.querySelector('#app-title').textContent = app.title;
    document.querySelector('#app-category').textContent = `· ${app.category}`;
    document.querySelector('#app-meta').textContent =
      `🏫 ${data.school.name} ｜ 分类：${app.category} ｜ 学生维护`;
    document.querySelector('#app-views').textContent = String(app.views);
    renderSteps(app.steps);
  } catch (error) {
    document.querySelector('#app-steps').replaceChildren(
      el('li', {}, el('div', {}, el('b', {}, errorText(error)))),
    );
    document.querySelector('#app-title').textContent = '工具不存在';
  }
}

async function main() {
  await mountSiteNav();
  await loadApp();

  document.querySelector('#done-btn').addEventListener('click', () => {
    toast('已记录：按步骤办好了 ✅', 'success');
  });

  document.querySelector('#correction-btn').addEventListener('click', async () => {
    const me = await getMe();
    if (!me) return showLoginRequired('提交纠错需要先登录');

    const value = await openDialog({
      title: '反馈路径问题',
      message: '请描述哪里不对：入口位置、菜单名称、第几步失效等。管理员会核实。',
      fields: [{ name: 'content', label: '问题描述', type: 'textarea', placeholder: '例如：第 2 步菜单改成了「学生事务」' }],
      confirmText: '提交纠错',
      danger: false,
    });
    if (!value?.content) return;
    if (value.content.length < 5) {
      return toast('请至少写 5 个字说明问题', 'error');
    }

    try {
      await api.post(`/api/apps/${appId}/corrections`, { content: value.content });
      toast('纠错已提交，谢谢你的反馈', 'success');
    } catch (error) {
      toast(errorText(error), 'error');
    }
  });
}

main();
