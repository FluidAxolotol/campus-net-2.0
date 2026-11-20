// ============================================================
// 真题问答（演示版）
// 对话渲染只用 textContent；答案里的换行用 white-space 保留。
// ============================================================

import { api } from '../api.js';
import {
  mountSiteNav, requireLogin, getQuery,
} from '../auth.js';
import {
  el, mount, setBusy, toast, emptyState, errorText,
} from '../ui.js';

const examId = Number(getQuery('id'));
const qaChat = document.querySelector('#qa-chat');
let exam = null;

function message(role, text) {
  return el('article', { class: `msg ${role}` },
    el('div', { class: 'av', 'aria-hidden': 'true' }, role === 'user' ? '🙂' : '🤖'),
    el('div', { class: 'bubble', style: 'white-space:pre-wrap;' }, text));
}

function renderThreads(threads) {
  if (!threads.length) {
    mount(qaChat, emptyState('还没有人提问。输入你的第一个问题吧。'));
    return;
  }
  mount(qaChat, threads.flatMap((thread) => [
    message('user', thread.question),
    message('ai', thread.answer),
  ]));
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

async function load() {
  if (!examId) {
    location.replace('exam-lib.html');
    return;
  }
  const me = await requireLogin(`exam-qa.html?id=${examId}`);
  if (!me) return;

  try {
    const data = await api.get(`/api/exams/${examId}/questions`);
    exam = data.exam;
    document.title = `${exam.title} · 真题问答`;
    document.querySelector('#qa-file-type').textContent = 'PDF';
    document.querySelector('#qa-doc-title').textContent = exam.title;
    document.querySelector('#qa-doc-meta').textContent =
      `${exam.semester} · ${exam.examType} ｜ 上传：@${exam.uploader.displayName} ｜ ${exam.hasAnswer ? '含答案' : '无答案'}`;
    renderThreads(data.threads);

    const initialQuestion = getQuery('q');
    if (initialQuestion) {
      document.querySelector('#qa-input').value = initialQuestion;
      await ask(initialQuestion);
    }
  } catch (error) {
    mount(qaChat, emptyState(errorText(error)));
  }
}

async function ask(question) {
  const button = document.querySelector('#qa-btn');
  const restore = setBusy(button, true, '回答中…');
  qaChat.append(message('user', question));
  try {
    const data = await api.post(`/api/exams/${examId}/questions`, { question });
    qaChat.append(message('ai', data.thread.answer));
    document.querySelector('#qa-input').value = '';
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } catch (error) {
    toast(errorText(error), 'error');
  } finally {
    restore();
  }
}

async function main() {
  await mountSiteNav();
  await load();

  document.querySelector('#qa-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.querySelector('#qa-input');
    const question = input.value.trim();
    if (question.length < 2) return toast('请至少写 2 个字', 'error');
    await ask(question);
  });
}

main();
