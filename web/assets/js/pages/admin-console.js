// ============================================================
// 管理后台工作台
// 所有数据请求都带管理员 Cookie；后端用会话里的 currentSchoolId
// 限定学校，前端无法通过参数跨校。
// ============================================================

import { api } from '../api.js';
import {
  el, mount, formatDate, timeAgo, toast, errorText, statusLabels, statusClass,
  emptyState, openDialog, confirmDialog, setBusy, clearMessage, showError,
} from '../ui.js';

const mainEl = document.querySelector('#admin-main');
const state = {
  me: null,
  school: null,
  schools: [],
  tab: 'overview',
};

const ACTION_LABELS = {
  'admin.setup': '管理员完成绑定',
  'admin.recovery_used': '使用恢复码',
  'admin.switch_school': '切换学校',
  'admin.password_change': '修改管理员密码',
  'user.approve': '通过注册',
  'user.reject': '驳回注册',
  'user.enable': '启用用户',
  'user.disable': '停用用户',
  'exam.approve': '通过真题',
  'exam.reject': '驳回真题',
  'post.published': '恢复帖子',
  'post.hidden': '隐藏帖子',
  'post.deleted': '删除帖子',
  'correction.resolved': '处理纠错',
  'correction.ignored': '忽略纠错',
  'reset.password': '重置用户密码',
  'reset.ignore': '忽略找回申请',
  'app.active': '上架应用',
  'app.hidden': '下架应用',
};

function table(headers, rows, emptyText = '暂无数据') {
  if (!rows.length) return el('div', { class: 'body-pad' }, emptyState(emptyText));
  const thead = el('thead', {}, el('tr', {}, headers.map((header) => el('th', {}, header))));
  const tbody = el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((cell) => el('td', {}, cell)))));
  return el('div', { class: 'table-scroll' }, el('table', { class: 'table' }, thead, tbody));
}

function panel(title, body, { note = '', toolbar = null } = {}) {
  return el('section', { class: 'panel' },
    el('div', { class: 'h' }, el('b', {}, title), note ? el('span', { class: 'panel-note' }, note) : null),
    toolbar,
    body);
}

function pill(status) {
  return el('span', { class: `st st-${statusClass(status)}` }, statusLabels(status));
}

function action(label, onClick, danger = false) {
  return el('button', {
    type: 'button',
    class: `text-btn${danger ? ' danger' : ''}`,
    onclick: onClick,
  }, label);
}

function statCard(value, label, pending = false) {
  return el('article', { class: 'kpi' },
    el('div', { class: 'v' }, String(value), pending ? el('em', {}, '待办') : null),
    el('div', { class: 'k' }, label));
}

function setActiveTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.side a[data-tab]').forEach((link) => {
    link.classList.toggle('on', link.dataset.tab === tab);
  });
}

function go(tab) {
  location.hash = `#${tab}`;
  setActiveTab(tab);
  renderTab(tab);
}

function toolbarWithFilter(select, handler) {
  select.className = 'admin-filter';
  select.addEventListener('change', () => handler(select.value));
  return el('div', { class: 'admin-toolbar' },
    el('span', { class: 'admin-note' }, '筛选：'),
    select);
}

function statusSelect(options, selected) {
  const select = el('select', {});
  for (const [value, label] of options) {
    const option = el('option', { value }, label);
    if (value === selected) option.selected = true;
    select.append(option);
  }
  return select;
}

// ---------------- 工作台 ----------------
async function renderOverview() {
  mount(mainEl, el('div', { class: 'panel' }, el('div', { class: 'h' }, el('b', {}, '正在加载工作台…'))));
  try {
    const [{ data: overview }, auditResult] = await Promise.all([
      api.get('/api/admin/overview', { raw: true }),
      api.getRaw('/api/admin/audit-logs?pageSize=8'),
    ]);
    const stats = overview.stats;
    const kpis = el('section', { class: 'kpis' },
      statCard(stats.pendingUsers, '待审核注册', true),
      statCard(stats.pendingExams, '待审核真题', true),
      statCard(stats.openCorrections, '未处理纠错', true),
      statCard(stats.openResets, '找回密码申请', true),
      statCard(stats.activeUsers, '本校正常用户'),
      statCard(stats.approvedExams, '已通过真题'),
      statCard(stats.publishedPosts, '社区帖子'),
      statCard(stats.activeApps, '上架应用'));

    const todoItems = [
      ['注册审核', stats.pendingUsers, 'registrations', '👥'],
      ['真题审核', stats.pendingExams, 'exams', '📚'],
      ['纠错反馈', stats.openCorrections, 'corrections', '🚨'],
      ['找回密码', stats.openResets, 'resets', '🔑'],
    ];
    const todoList = el('div', { class: 'body-pad' },
      todoItems.every(([, count]) => count === 0)
        ? emptyState('暂无待办，今天可以早点休息')
        : todoItems.filter(([, count]) => count > 0).map(([label, count, tab, icon]) => el(
          'div',
          { style: 'display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);' },
          el('span', {}, icon),
          el('span', { style: 'flex:1;font-size:13px;' }, label),
          el('span', { class: 'badge-dot' }, String(count)),
          action('去处理 ›', () => go(tab)),
        )));

    const auditRows = (auditResult.data || []).map((row) => [
      formatDate(row.createdAt),
      ACTION_LABELS[row.action] || row.action,
      row.targetType ? `${row.targetType} #${row.targetId}` : '—',
      row.ip || '—',
    ]);

    const panels = el('div', { class: 'panels-grid' },
      panel('📌 待办事项', todoList, { note: '只统计当前学校' }),
      panel('🧾 最近审计', table(['时间', '操作', '对象', 'IP'], auditRows, '还没有审计记录')));

    const head = el('div', { class: 'panel' },
      el('div', { class: 'h' },
        el('b', {}, `🏫 ${state.school.name} · 工作台`),
        el('span', { class: 'panel-note' }, '数据按学校隔离，当前会话只查询本校')));

    mount(mainEl, head, kpis, panels);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      location.replace('admin-login.html');
      return;
    }
    mount(mainEl, panel('工作台', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
  }
}

// ---------------- 注册审核 ----------------
async function renderRegistrations(status = 'pending') {
  setActiveTab('registrations');
  mount(mainEl, el('div', { class: 'panel' }, el('div', { class: 'h' }, el('b', {}, '正在加载注册申请…'))));
  try {
    const result = await api.getRaw(`/api/admin/registrations?status=${status}&pageSize=50`);
    const rows = result.data.map((user) => {
      const actions = [];
      if (user.status === 'pending') {
        actions.push(action('通过', async () => {
          if (!await confirmDialog({
            title: '通过注册申请',
            message: `确认让「${user.displayName}」（${user.studentNo}）登录吗？`,
            confirmText: '通过',
            danger: false,
          })) return;
          try {
            await api.post(`/api/admin/registrations/${user.id}/approve`);
            toast('已通过审核', 'success');
            await refreshBadges();
            renderRegistrations(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }));
        actions.push(action('驳回', async () => {
          const value = await openDialog({
            title: '驳回注册申请',
            message: `请填写给「${user.displayName}」看的驳回原因。`,
            fields: [{ name: 'reason', label: '驳回原因', type: 'textarea', placeholder: '如：校园邮箱无法核实，请联系管理员' }],
            confirmText: '确认驳回',
            danger: true,
          });
          if (!value?.reason) return;
          try {
            await api.post(`/api/admin/registrations/${user.id}/reject`, { reason: value.reason });
            toast('已驳回', 'success');
            await refreshBadges();
            renderRegistrations(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }, true));
      } else if (user.status === 'active') {
        actions.push(action('停用账号', async () => {
          if (!await confirmDialog({ title: '停用用户', message: `停用后「${user.displayName}」会立刻掉线，确认？`, confirmText: '停用' })) return;
          try {
            await api.post(`/api/admin/users/${user.id}/status`, { status: 'disabled' });
            toast('已停用', 'success');
            renderRegistrations(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }, true));
      } else if (user.status === 'disabled') {
        actions.push(action('启用账号', async () => {
          try {
            await api.post(`/api/admin/users/${user.id}/status`, { status: 'active' });
            toast('已启用', 'success');
            renderRegistrations(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }));
      }

      return [
        el('b', {}, user.displayName),
        user.studentNo,
        user.email,
        user.college || '—',
        user.degree,
        formatDate(user.createdAt),
        pill(user.status),
        actions.length ? el('div', { class: 'row-actions' }, actions) : el('span', { class: 'muted' }, user.rejectReason || '—'),
      ];
    });

    const select = statusSelect([
      ['pending', '待审核'],
      ['active', '正常'],
      ['rejected', '已驳回'],
      ['disabled', '已停用'],
    ], status);

    mount(mainEl, panel(
      '👥 注册审核',
      table(['用户', '学号', '校园邮箱', '学院', '学历', '提交时间', '状态', '操作'], rows, '当前状态下没有用户'),
      { note: `共 ${result.meta.total} 人 · 审核通过后才能登录`, toolbar: toolbarWithFilter(select, renderRegistrations) },
    ));
  } catch (error) {
    mount(mainEl, panel('注册审核', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
  }
}

// ---------------- 真题审核 ----------------
async function renderExams(status = 'pending') {
  setActiveTab('exams');
  try {
    const result = await api.getRaw(`/api/admin/exams?status=${status}&pageSize=50`);
    const rows = result.data.map((exam) => {
      const actions = [];
      if (exam.status === 'pending') {
        actions.push(action('通过', async () => {
          if (!await confirmDialog({
            title: '通过真题审核',
            message: `《${exam.title}》通过后对全校可见。确认？`,
            confirmText: '通过',
            danger: false,
          })) return;
          try {
            await api.post(`/api/admin/exams/${exam.id}/review`, { action: 'approve', note: '' });
            toast('已通过', 'success');
            await refreshBadges();
            renderExams(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }));
        actions.push(action('驳回', async () => {
          const value = await openDialog({
            title: '驳回真题',
            message: `请填写驳回《${exam.title}》的原因。`,
            fields: [{ name: 'note', label: '原因', type: 'textarea', placeholder: '如：图片模糊、科目信息不符' }],
            confirmText: '确认驳回',
            danger: true,
          });
          if (!value?.note) return;
          try {
            await api.post(`/api/admin/exams/${exam.id}/review`, { action: 'reject', note: value.note });
            toast('已驳回', 'success');
            await refreshBadges();
            renderExams(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }, true));
      }

      return [
        el('div', {},
          el('b', {}, exam.title),
          el('div', { class: 'muted' }, exam.file?.originalName || '—')),
        exam.subject,
        exam.college,
        exam.semester,
        exam.uploader.displayName,
        formatDate(exam.createdAt),
        pill(exam.status),
        actions.length ? el('div', { class: 'row-actions' }, actions) : el('span', { class: 'muted' }, exam.reviewNote || '—'),
      ];
    });

    const select = statusSelect([
      ['pending', '待审核'],
      ['approved', '已通过'],
      ['rejected', '已驳回'],
    ], status);

    mount(mainEl, panel(
      '📚 真题审核',
      table(['文件', '科目', '学院', '学期', '上传者', '提交时间', '状态', '操作'], rows, '当前状态下没有真题'),
      { note: `共 ${result.meta.total} 份 · 审核通过后全校可见`, toolbar: toolbarWithFilter(select, renderExams) },
    ));
  } catch (error) {
    mount(mainEl, panel('真题审核', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
  }
}

// ---------------- 社区管理 ----------------
async function renderPosts(status = 'published') {
  setActiveTab('posts');
  try {
    const result = await api.getRaw(`/api/admin/posts?status=${status}&pageSize=50`);
    const rows = result.data.map((post) => {
      const actions = [];
      if (post.status === 'published') {
        actions.push(action('隐藏', async () => {
          try {
            await api.post(`/api/admin/posts/${post.id}/status`, { status: 'hidden' });
            toast('已隐藏', 'success');
            renderPosts(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }));
      } else {
        actions.push(action('恢复', async () => {
          try {
            await api.post(`/api/admin/posts/${post.id}/status`, { status: 'published' });
            toast('已恢复', 'success');
            renderPosts(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }));
      }
      if (post.status !== 'deleted') {
        actions.push(action('删除', async () => {
          if (!await confirmDialog({ title: '删除帖子', message: `确认删除《${post.title}》？`, confirmText: '删除' })) return;
          try {
            await api.post(`/api/admin/posts/${post.id}/status`, { status: 'deleted' });
            toast('已删除', 'success');
            renderPosts(status);
          } catch (error) {
            toast(errorText(error), 'error');
          }
        }, true));
      }

      return [
        el('div', {},
          el('b', {}, post.title),
          el('div', { class: 'muted' }, post.content.slice(0, 48) + (post.content.length > 48 ? '…' : ''))),
        post.board.name,
        post.author.displayName,
        String(post.likeCount),
        timeAgo(post.createdAt),
        pill(post.status),
        el('div', { class: 'row-actions' }, actions),
      ];
    });

    const select = statusSelect([
      ['published', '已发布'],
      ['hidden', '已隐藏'],
      ['deleted', '已删除'],
    ], status);

    mount(mainEl, panel(
      '💬 社区管理',
      table(['帖子', '版块', '作者', '点赞', '时间', '状态', '操作'], rows, '当前状态下没有帖子'),
      { note: `共 ${result.meta.total} 条`, toolbar: toolbarWithFilter(select, renderPosts) },
    ));
  } catch (error) {
    mount(mainEl, panel('社区管理', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
  }
}

// ---------------- 纠错反馈 ----------------
async function renderCorrections(status = 'open') {
  setActiveTab('corrections');
  try {
    const result = await api.getRaw(`/api/admin/corrections?status=${status}&pageSize=50`);
    const rows = result.data.map((correction) => [
      el('b', {}, correction.targetTitle || `应用 #${correction.targetId}`),
      el('div', { class: 'detail-text' }, correction.content),
      correction.user.displayName,
      formatDate(correction.createdAt),
      pill(correction.status),
      correction.status === 'open'
        ? el('div', { class: 'row-actions' },
          action('已修复', async () => {
            const value = await openDialog({
              title: '标记为已修复',
              message: '可以留一句处理说明（可选）。',
              fields: [{ name: 'note', label: '处理说明', type: 'text', placeholder: '如：已更新入口路径' }],
              confirmText: '保存',
              danger: false,
            });
            if (value === null) return;
            try {
              await api.post(`/api/admin/corrections/${correction.id}/status`, { status: 'resolved', note: value.note || '' });
              toast('已标记修复', 'success');
              await refreshBadges();
              renderCorrections(status);
            } catch (error) {
              toast(errorText(error), 'error');
            }
          }),
          action('忽略', async () => {
            const value = await openDialog({
              title: '忽略纠错',
              message: '可以留一句原因（可选）。',
              fields: [{ name: 'note', label: '原因', type: 'text', placeholder: '如：经核实路径无误' }],
              confirmText: '忽略',
              danger: true,
            });
            if (value === null) return;
            try {
              await api.post(`/api/admin/corrections/${correction.id}/status`, { status: 'ignored', note: value.note || '' });
              toast('已忽略', 'success');
              await refreshBadges();
              renderCorrections(status);
            } catch (error) {
              toast(errorText(error), 'error');
            }
          }, true))
        : el('span', { class: 'muted' }, correction.adminNote || '—'),
    ]);

    const select = statusSelect([
      ['open', '待处理'],
      ['resolved', '已修复'],
      ['ignored', '已忽略'],
    ], status);

    mount(mainEl, panel(
      '🚨 纠错反馈',
      table(['条目', '反馈内容', '提交者', '时间', '状态', '操作'], rows, '当前状态下没有纠错'),
      { note: `共 ${result.meta.total} 条`, toolbar: toolbarWithFilter(select, renderCorrections) },
    ));
  } catch (error) {
    mount(mainEl, panel('纠错反馈', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
  }
}

// ---------------- 找回密码 ----------------
async function renderResets(status = 'open') {
  setActiveTab('resets');
  try {
    const result = await api.getRaw(`/api/admin/reset-requests?status=${status}&pageSize=50`);
    const rows = result.data.map((request) => [
      el('div', {}, el('b', {}, request.user.displayName), el('div', { class: 'muted' }, request.user.email)),
      request.user.studentNo,
      el('div', { class: 'detail-text' }, request.note || '—'),
      formatDate(request.createdAt),
      pill(request.status),
      request.status === 'open'
        ? el('div', { class: 'row-actions' },
          action('生成临时密码', async () => {
            if (!await confirmDialog({
              title: '重置用户密码',
              message: `将为「${request.user.displayName}」生成一次性临时密码，并踢掉其所有旧会话。`,
              confirmText: '重置',
              danger: false,
            })) return;
            try {
              const data = await api.post(`/api/admin/reset-requests/${request.id}/handle`, { action: 'reset' });
              await openDialog({
                title: '临时密码（只显示一次）',
                message: `${data.user.displayName}（${data.user.studentNo}）的临时密码如下。请通过线下渠道转交；对方登录后应立即修改。`,
                fields: [{ name: 'tempPassword', label: '临时密码', type: 'text', value: data.tempPassword }],
                confirmText: '我已记下',
                danger: false,
              });
              await refreshBadges();
              renderResets(status);
            } catch (error) {
              toast(errorText(error), 'error');
            }
          }),
          action('忽略', async () => {
            try {
              await api.post(`/api/admin/reset-requests/${request.id}/handle`, { action: 'ignore' });
              toast('已忽略', 'success');
              await refreshBadges();
              renderResets(status);
            } catch (error) {
              toast(errorText(error), 'error');
            }
          }, true))
        : el('span', { class: 'muted' }, request.handledAt ? formatDate(request.handledAt) : '—'),
    ]);

    const select = statusSelect([
      ['open', '待处理'],
      ['done', '已完成'],
      ['ignored', '已忽略'],
    ], status);

    mount(mainEl, panel(
      '🔑 找回密码申请',
      table(['用户', '学号', '说明', '时间', '状态', '操作'], rows, '当前状态下没有申请'),
      { note: `共 ${result.meta.total} 条 · 重置后旧会话立即失效`, toolbar: toolbarWithFilter(select, renderResets) },
    ));
  } catch (error) {
    mount(mainEl, panel('找回密码', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
  }
}

// ---------------- 应用与路径 ----------------
async function renderApps() {
  setActiveTab('apps');
  try {
    const result = await api.getRaw('/api/admin/apps?pageSize=50');
    const rows = result.data.map((app) => [
      el('div', {}, el('b', {}, `${app.icon} ${app.title}`), el('div', { class: 'muted' }, app.summary)),
      app.category,
      String(app.views),
      pill(app.status),
      action(app.status === 'active' ? '下架' : '上架', async () => {
        try {
          await api.post(`/api/admin/apps/${app.id}/status`, {
            status: app.status === 'active' ? 'hidden' : 'active',
          });
          toast('状态已更新', 'success');
          renderApps();
        } catch (error) {
          toast(errorText(error), 'error');
        }
      }, app.status === 'active'),
    ]);

    mount(mainEl, panel(
      '🧭 应用与路径',
      table(['应用', '分类', '浏览', '状态', '操作'], rows, '还没有应用'),
      { note: `共 ${result.meta.total} 个工具 · 下架后前台不可见` },
    ));
  } catch (error) {
    mount(mainEl, panel('应用与路径', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
  }
}

// ---------------- 审计日志 ----------------
async function renderAudits() {
  setActiveTab('audits');
  try {
    const result = await api.getRaw('/api/admin/audit-logs?pageSize=50');
    const rows = result.data.map((row) => [
      formatDate(row.createdAt),
      ACTION_LABELS[row.action] || row.action,
      row.targetType ? `${row.targetType} #${row.targetId}` : '—',
      `${row.actorType} #${row.actorId ?? '—'}`,
      row.ip || '—',
      el('div', { class: 'detail-text' }, row.detail ? JSON.stringify(row.detail) : '—'),
    ]);
    mount(mainEl, panel(
      '🧾 审计日志',
      table(['时间', '操作', '对象', '操作者', 'IP', '详情'], rows, '还没有审计记录'),
      { note: `共 ${result.meta.total} 条 · 只显示本校操作` },
    ));
  } catch (error) {
    mount(mainEl, panel('审计日志', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
  }
}

// ---------------- 安全设置 ----------------
function renderSecurity() {
  setActiveTab('security');
  const admin = state.me.admin;

  const info = el('div', { class: 'body-pad' },
    el('div', { class: 'admin-note', style: 'font-size:13px;line-height:2;color:var(--ink-2);' },
      el('div', {}, `账号：${admin.username}`),
      el('div', {}, `显示名：${admin.displayName}`),
      el('div', {}, `当前管理学校：${state.school.name}`),
      el('div', {}, `动态码：${admin.totpConfirmed ? '已绑定（腾讯身份验证器）' : '未绑定'}`),
      el('div', {}, '管理员 Cookie：campus_admin_sid（与用户会话完全独立，30 分钟无操作过期）'),
      el('div', {}, '数据隔离：所有查询都使用会话中的 currentSchoolId，前端传参无效')));

  const form = el('form', { class: 'body-pad' });
  const current = el('input', { type: 'password', autocomplete: 'current-password', placeholder: '当前管理员密码' });
  const next = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '8–64 位，含字母和数字' });
  const confirm = el('input', { type: 'password', autocomplete: 'new-password', placeholder: '再输入一次' });
  const code = el('input', { inputmode: 'numeric', maxlength: 6, placeholder: '当前 6 位动态码' });
  const errorBox = el('div', { class: 'form-message form-message-error', hidden: true });
  const submit = el('button', { type: 'submit', class: 'admin-submit' }, '更新密码');

  form.append(
    el('div', { class: 'form-grid' },
      el('div', { class: 'admin-form-field' }, el('label', {}, '当前密码'), current),
      el('div', { class: 'admin-form-field' }, el('label', {}, '新密码'), next),
      el('div', { class: 'admin-form-field' }, el('label', {}, '确认新密码'), confirm),
      el('div', { class: 'admin-form-field' }, el('label', {}, '动态码'), code)),
    errorBox,
    submit,
    el('div', { class: 'admin-note', style: 'margin-top:10px;' }, '修改后，其他设备上的管理员会话会被踢下线；当前会话保留。'),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(errorBox);
    if (!current.value) return showError(errorBox, { message: '请输入当前密码', code: 'VALIDATION_FAILED' });
    if (next.value.length < 8) return showError(errorBox, { message: '新密码至少 8 位', code: 'VALIDATION_FAILED' });
    if (next.value !== confirm.value) return showError(errorBox, { message: '两次输入的新密码不一致', code: 'VALIDATION_FAILED' });
    if (!/^\d{6}$/.test(code.value.trim())) return showError(errorBox, { message: '请输入 6 位动态码', code: 'VALIDATION_FAILED' });

    const restore = setBusy(submit, true, '更新中…');
    try {
      await api.post('/api/admin/auth/password', {
        currentPassword: current.value,
        newPassword: next.value,
        code: code.value.trim(),
      });
      form.reset();
      toast('管理员密码已更新', 'success');
    } catch (error) {
      showError(errorBox, error);
    } finally {
      restore();
    }
  });

  mount(mainEl,
    panel('🔐 当前管理员', info, { note: '密码 + TOTP 双因素' }),
    panel('修改管理员密码', form, { note: '需要当前密码与动态码' }));
}

// ---------------- 顶栏与徽标 ----------------
async function refreshBadges() {
  try {
    const result = await api.get('/api/admin/overview');
    const stats = result.stats;
    const set = (id, count) => {
      const node = document.querySelector(`#${id}`);
      if (!node) return;
      node.textContent = String(count);
      node.hidden = count === 0;
    };
    set('badge-registrations', stats.pendingUsers);
    set('badge-exams', stats.pendingExams);
    set('badge-corrections', stats.openCorrections);
    set('badge-resets', stats.openResets);
  } catch {
    // 徽标失败不影响主流程
  }
}

async function refreshShell() {
  const data = await api.get('/api/admin/auth/me');
  if (data.stage !== 'active') {
    location.replace('admin-login.html');
    return false;
  }
  state.me = data;
  state.school = data.school;

  document.querySelector('#admin-role').textContent =
    `👤 ${data.admin.displayName} · ${data.admin.username}`;

  try {
    state.schools = await api.get('/api/schools');
    const select = document.querySelector('#school-switcher');
    select.replaceChildren();
    for (const school of state.schools) {
      const option = el('option', { value: String(school.id) }, `🏫 ${school.name}`);
      if (school.id === data.school?.id) option.selected = true;
      select.append(option);
    }
  } catch {
    // 学校列表失败时保留现有标签
  }
  return true;
}

async function switchSchool(schoolId) {
  if (!schoolId || schoolId === state.school?.id) return;
  try {
    const data = await api.post('/api/admin/auth/switch-school', { schoolId });
    state.school = data.school;
    toast(`已切换到 ${data.school.name}`, 'success');
    await refreshBadges();
    renderTab(state.tab);
  } catch (error) {
    toast(errorText(error), 'error');
    document.querySelector('#school-switcher').value = String(state.school?.id || '');
  }
}

function renderTab(tab) {
  switch (tab) {
    case 'registrations': return renderRegistrations();
    case 'exams': return renderExams();
    case 'posts': return renderPosts();
    case 'corrections': return renderCorrections();
    case 'resets': return renderResets();
    case 'apps': return renderApps();
    case 'audits': return renderAudits();
    case 'security': return renderSecurity();
    case 'overview':
    default: return renderOverview();
  }
}

async function main() {
  try {
    const ok = await refreshShell();
    if (!ok) return;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      location.replace('admin-login.html');
      return;
    }
    mount(mainEl, panel('管理后台', el('div', { class: 'body-pad' }, emptyState(errorText(error)))));
    return;
  }

  document.querySelectorAll('.side a[data-tab]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      go(link.dataset.tab);
    });
  });

  document.querySelector('#admin-logout').addEventListener('click', async (event) => {
    event.preventDefault();
    await api.post('/api/admin/auth/logout').catch(() => {});
    location.href = 'admin-login.html';
  });

  document.querySelector('#school-switcher').addEventListener('change', (event) => {
    switchSchool(Number(event.target.value));
  });

  // 支持 #registrations 这种深链接
  const initial = location.hash.slice(1);
  const validTabs = ['overview', 'registrations', 'exams', 'posts', 'corrections', 'resets', 'apps', 'audits', 'security'];
  const tab = validTabs.includes(initial) ? initial : 'overview';
  setActiveTab(tab);
  renderTab(tab);
  refreshBadges();
}

main();
