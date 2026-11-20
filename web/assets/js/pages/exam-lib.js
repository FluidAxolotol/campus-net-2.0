// ============================================================
// 真题库：筛选、分页、下载与 AI 问答入口
// 列表游客可读；下载/问答需要登录。
// ============================================================

import { api } from '../api.js';
import {
  mountSiteNav, currentSchoolId, onSchoolChange, getCachedMe,
  showLoginRequired, getQuery,
} from '../auth.js';
import {
  el, mount, emptyState, errorText, toast,
} from '../ui.js';

const COLLEGES = [
  ['', '全部学院'],
  ['计算机学院', '计算机学院'],
  ['数学学院', '数学学院'],
  ['软件学院', '软件学院'],
  ['外国语学院', '外国语学院'],
];

const SEMESTERS = [
  ['', '全部学期'],
  ['2025 秋', '2025 秋'],
  ['2025 春', '2025 春'],
  ['2024 秋', '2024 秋'],
];

const state = {
  college: '',
  semester: '',
  q: getQuery('q') || '',
  page: 1,
  totalPages: 1,
  exams: [],
};

function renderFilter(container, items, selected, onPick) {
  container.replaceChildren(...items.map(([value, label]) => el(
    'div',
    {
      class: `item${value === selected ? ' on' : ''}`,
      role: 'button',
      tabindex: 0,
      onclick: () => onPick(value),
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick(value);
        }
      },
    },
    label,
  )));
}

function renderFilters() {
  renderFilter(
    document.querySelector('#college-filters'),
    COLLEGES,
    state.college,
    (value) => {
      state.college = value;
      state.page = 1;
      renderFilters();
      loadExams();
    },
  );
  renderFilter(
    document.querySelector('#semester-filters'),
    SEMESTERS,
    state.semester,
    (value) => {
      state.semester = value;
      state.page = 1;
      renderFilters();
      loadExams();
    },
  );
}

function renderPager(meta) {
  const pager = document.querySelector('#exam-pager');
  pager.replaceChildren();
  if (meta.totalPages <= 1) return;

  const addPage = (label, page, active = false) => {
    const node = el('span', {
      role: 'button',
      tabindex: 0,
      class: active ? 'on' : '',
      onclick: () => {
        if (page < 1 || page > meta.totalPages || page === state.page) return;
        state.page = page;
        loadExams();
      },
    }, label);
    pager.append(node);
  };

  addPage('‹', state.page - 1);
  const start = Math.max(1, Math.min(state.page - 2, meta.totalPages - 4));
  const end = Math.min(meta.totalPages, start + 4);
  for (let page = start; page <= end; page += 1) {
    addPage(String(page), page, page === state.page);
  }
  addPage('›', state.page + 1);
}

function renderExams(exams) {
  const list = document.querySelector('#exam-list');
  if (!exams.length) {
    mount(list, emptyState('没有找到符合筛选条件的真题'));
    return;
  }

  mount(list, exams.map((exam) => {
    const me = getCachedMe();
    const qaLink = el('a', {
      class: 'qa2',
      href: `exam-qa.html?id=${exam.id}`,
      onclick: (event) => {
        if (!me) {
          event.preventDefault();
          showLoginRequired('AI 问答面向登录用户开放');
        }
      },
    }, '✨ 就这份提问');

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
          if (error.status === 401) return showLoginRequired('登录已过期');
          toast(errorText(error), 'error');
        }
      },
    }, '⬇ 下载');

    return el('article', { class: 'exam' },
      el('div', { class: 'file' }, exam.file?.fileType || 'PDF'),
      el('div', { class: 't' },
        el('b', {}, exam.title),
        el('span', { class: 'meta' },
          `${exam.hasAnswer ? '含答案' : '无答案'} ｜ 上传：@${exam.uploader.displayName} ｜ 下载 ${exam.downloadCount} 次 ｜ ${exam.semester} ${exam.examType}`)),
      qaLink,
      download);
  }));
}

async function loadExams() {
  const schoolId = await currentSchoolId();
  if (!schoolId) {
    mount(document.querySelector('#exam-list'), emptyState('请先选择学校'));
    return;
  }

  const params = new URLSearchParams({
    schoolId: String(schoolId),
    page: String(state.page),
    pageSize: '10',
  });
  if (state.college) params.set('college', state.college);
  if (state.semester) params.set('semester', state.semester);
  if (state.q) params.set('q', state.q);

  mount(document.querySelector('#exam-list'), emptyState('正在加载真题…'));
  try {
    const result = await api.getRaw(`/api/exams?${params.toString()}`);
    state.exams = result.data;
    state.totalPages = result.meta.totalPages;
    if (state.page > result.meta.totalPages) {
      state.page = result.meta.totalPages;
      return loadExams();
    }

    document.querySelector('#exam-list-title').textContent =
      state.college || state.semester || state.q ? '筛选结果' : '本校真题';
    document.querySelector('#exam-list-count').textContent =
      `${result.meta.total} 份 · 第 ${result.meta.page} / ${result.meta.totalPages} 页`;
    renderExams(result.data);
    renderPager(result.meta);
  } catch (error) {
    mount(document.querySelector('#exam-list'), emptyState(errorText(error)));
  }
}

async function main() {
  await mountSiteNav();
  renderFilters();

  const navSearch = document.querySelector('.search input');
  if (navSearch) {
    navSearch.value = state.q;
    navSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        state.q = navSearch.value.trim();
        state.page = 1;
        loadExams();
      }
    });
  }

  document.querySelector('#exam-qa-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const question = document.querySelector('#exam-qa-input').value.trim();
    if (!getCachedMe()) return showLoginRequired('AI 问答面向登录用户开放');
    if (!state.exams.length) return toast('当前筛选下没有可提问的真题', 'error');
    const examId = state.exams[0].id;
    const params = new URLSearchParams({ id: String(examId) });
    if (question) params.set('q', question);
    location.href = `exam-qa.html?${params.toString()}`;
  });

  onSchoolChange(() => {
    state.page = 1;
    loadExams();
  });

  await loadExams();
}

main();
