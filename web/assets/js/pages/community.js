// ============================================================
// 校园社区：版块、帖子、发帖、点赞
// 游客可阅读；写操作需要登录。所有数据按当前学校隔离。
// ============================================================

import { api } from '../api.js';
import {
  mountSiteNav, currentSchoolId, onSchoolChange, getCachedMe,
  showLoginRequired,
} from '../auth.js';
import {
  el, mount, timeAgo, toast, emptyState, errorText, openDialog,
} from '../ui.js';

const boardClass = {
  secondhand: 't-2nd',
  lost: 't-lost',
  study: 't-study',
  club: 't-club',
  carpool: 't-carpool',
  treehole: 't-hole',
};

const state = {
  boards: [],
  boardId: null,
  sort: 'latest',
  q: '',
  posts: [],
};

function renderBoards() {
  const container = document.querySelector('#board-filters');
  const allCount = state.boards.reduce((sum, board) => sum + board.postCount, 0);
  const items = [
    el('a', {
      href: '#',
      class: state.boardId === null ? 'on' : '',
      onclick: (event) => {
        event.preventDefault();
        state.boardId = null;
        renderBoards();
        loadPosts();
      },
    }, '🏷️ 全部 ', el('span', { class: 'cnt' }, String(allCount))),
  ];

  for (const board of state.boards) {
    items.push(el('a', {
      href: '#',
      class: state.boardId === board.id ? 'on' : '',
      onclick: (event) => {
        event.preventDefault();
        state.boardId = board.id;
        renderBoards();
        loadPosts();
      },
    }, boardIcon(board.code), ` ${board.name} `, el('span', { class: 'cnt' }, String(board.postCount))));
  }
  container.replaceChildren(...items);
}

function boardIcon(code) {
  return {
    secondhand: '🛒',
    lost: '🔍',
    carpool: '🚗',
    club: '🎪',
    study: '📖',
    treehole: '🌳',
  }[code] || '🏷️';
}

function likeButton(post) {
  return el('span', {
    role: 'button',
    tabindex: 0,
    class: post.likedByMe ? 'hot' : '',
    onclick: async () => {
      if (!getCachedMe()) return showLoginRequired('点赞需要先登录');
      try {
        const data = await api.post(`/api/posts/${post.id}/like`);
        post.likedByMe = data.liked;
        post.likeCount = data.likeCount;
        renderPosts();
        toast(data.liked ? '已点赞' : '已取消点赞', 'success');
      } catch (error) {
        toast(errorText(error), 'error');
      }
    },
  }, `👍 ${post.likeCount}`);
}

function renderPosts() {
  const feed = document.querySelector('#community-feed');
  if (!state.posts.length) {
    mount(feed, emptyState('这个版块还没有帖子，登录后发第一条吧'));
    return;
  }

  mount(feed, state.posts.map((post) => el(
    'article',
    { class: 'postcard' },
    el('header', { class: 'ph' },
      el('div', { class: 'avatar', 'aria-hidden': 'true' }, '🧑‍🎓'),
      el('div', {},
        el('div', { class: 'who' },
          post.author.displayName,
          ' ',
          el('span', { class: `tag ${boardClass[post.board.code] || 't-hole'}` }, post.board.name)),
        el('div', { class: 'when' }, `${timeAgo(post.createdAt)} · 本校`))),
    el('div', { class: 'title' }, post.title),
    el('div', { class: 'body' }, post.content),
    el('footer', { class: 'foot' },
      el('span', {}, `💬 ${post.commentCount}`),
      likeButton(post),
      el('span', { onclick: () => toast('收藏功能属于 P1，本版本暂未实现', 'info') }, '⭐ 收藏'),
      el('span', { onclick: () => toast('举报入口属于 P1，本版本暂未实现', 'info') }, '🚩 举报')),
  )));
}

async function loadBoards() {
  const schoolId = await currentSchoolId();
  if (!schoolId) return;
  try {
    state.boards = await api.get(`/api/boards?schoolId=${schoolId}`);
    renderBoards();
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

async function loadPosts() {
  const schoolId = await currentSchoolId();
  if (!schoolId) {
    mount(document.querySelector('#community-feed'), emptyState('请先选择学校'));
    return;
  }

  const params = new URLSearchParams({
    schoolId: String(schoolId),
    sort: state.sort,
    pageSize: '50',
  });
  if (state.boardId) params.set('boardId', String(state.boardId));
  if (state.q) params.set('q', state.q);

  mount(document.querySelector('#community-feed'), emptyState('正在加载帖子…'));
  try {
    const result = await api.getRaw(`/api/posts?${params.toString()}`);
    state.posts = result.data;
    document.querySelector('#post-count').textContent =
      `${result.meta.total} 条 · ${state.sort === 'hot' ? '按热度' : '按最新'}`;
    renderPosts();
  } catch (error) {
    mount(document.querySelector('#community-feed'), emptyState(errorText(error)));
  }
}

async function createPost() {
  const me = getCachedMe();
  if (!me) return showLoginRequired('发帖需要先登录');
  if (!state.boards.length) return toast('版块还没加载好，请稍后再试', 'error');

  const value = await openDialog({
    title: '发布新帖子',
    message: '内容会显示给本校同学；请勿发布个人隐私或侵权内容。',
    fields: [
      {
        name: 'boardId',
        label: '版块',
        type: 'select',
        options: state.boards.map((board) => [board.id, board.name]),
        value: String(state.boardId || state.boards[0].id),
      },
      { name: 'title', label: '标题', type: 'text', placeholder: '一句话说清楚（至少 4 个字）' },
      { name: 'content', label: '正文', type: 'textarea', placeholder: '补充细节，方便同学回复' },
    ],
    confirmText: '发布',
    danger: false,
  });
  if (!value) return;
  if (!value.title || value.title.length < 4) return toast('标题至少 4 个字', 'error');
  if (!value.content) return toast('请填写正文', 'error');

  try {
    await api.post('/api/posts', {
      boardId: Number(value.boardId),
      title: value.title,
      content: value.content,
    });
    toast('帖子已发布', 'success');
    await Promise.all([loadBoards(), loadPosts()]);
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

async function main() {
  await mountSiteNav();

  document.querySelector('#new-post-btn').addEventListener('click', createPost);

  document.querySelectorAll('.topbar .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.sort = tab.dataset.sort;
      document.querySelectorAll('.topbar .tab').forEach((node) => node.classList.toggle('on', node === tab));
      loadPosts();
    });
  });

  let timer = null;
  document.querySelector('#community-search').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = event.target.value.trim();
      loadPosts();
    }, 300);
  });

  onSchoolChange(() => {
    state.boardId = null;
    loadBoards();
    loadPosts();
  });

  await loadBoards();
  await loadPosts();
}

main();
