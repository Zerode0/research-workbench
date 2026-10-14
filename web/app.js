// app.js — 工作台外壳：共享状态、导航、首页、导入导出。
import {
  api, h, clear, toast, openConfirm, openForm, matches, formatTime,
  STATUS_LABELS, PAPER_KIND_LABELS,
} from './ui.js';
import * as ideasView from './ideas.js';
import * as conceptsView from './concepts.js';
import * as papersView from './papers.js';

export const store = {
  ideas: [],
  concepts: [],
  papers: [],
  today: '',
  maxStepDays: 3,
  loaded: false,
};

const SECTIONS = [
  { id: 'ideas', label: 'Idea 地图', render: ideasView.render },
  { id: 'concepts', label: '概念学习', render: conceptsView.render },
  { id: 'papers', label: '文献库', render: papersView.render },
];

const ctx = {
  store,
  route: { section: 'home', id: '' },
  selection: { ideas: '', concepts: '', papers: '' },
  refresh,
  render,
  go,
  toast,
  openForm,
  openConfirm,
  editors: {},
};

let mount = null;
let navBar = null;
let currentSelection = { ideas: '', concepts: '', papers: '' };

/* ------------------------------------------------------------------ *
 * 路由与刷新
 * ------------------------------------------------------------------ */

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [section = 'home', id = ''] = raw.split('/');
  return { section: section || 'home', id: decodeURIComponent(id || '') };
}

export function go(section, id = '') {
  const target = `#/${section}${id ? '/' + encodeURIComponent(id) : ''}`;
  if (window.location.hash === target) {
    ctx.route = { section, id };
    render();
  } else {
    window.location.hash = target;
  }
}

async function refresh(options = {}) {
  const keepScroll = options.keepScroll ? window.scrollY : null;
  try {
    const data = await api.state();
    store.ideas = data.ideas || [];
    store.concepts = data.concepts || [];
    store.papers = data.papers || [];
    store.today = data.today || '';
    store.maxStepDays = data.max_step_days || 3;
    store.loaded = true;
  } catch (error) {
    store.loaded = true;
    toast(error.message || '读取数据失败', 'error');
  }
  render();
  if (keepScroll !== null) window.scrollTo(0, keepScroll);
}

function render() {
  if (!mount) return;
  const { section, id } = ctx.route;
  renderNav(section);
  clear(mount);
  if (section === 'home') {
    renderHome(mount);
    return;
  }
  const view = SECTIONS.find((item) => item.id === section);
  if (!view) {
    renderHome(mount);
    return;
  }
  if (id) currentSelection[section] = id;
  ctx.selection = currentSelection;
  view.render(ctx, mount);}

function renderNav(active) {
  clear(navBar);
  navBar.appendChild(h('a', {
    class: 'brand', href: '#/home',
    onclick: (event) => { event.preventDefault(); go('home'); },
  },
    h('span', { class: 'brand-mark', text: '研' }),
    h('span', { class: 'brand-text' },
      h('strong', { text: '科研工作台' }),
      h('small', { text: '数据保存于主机' }),
    ),
  ));
  const list = h('ul', { class: 'nav-list' });
  list.appendChild(h('li', {}, h('a', {
    class: `nav-link${active === 'home' ? ' active' : ''}`, href: '#/home',
    onclick: (event) => { event.preventDefault(); go('home'); },
  }, '总览')));
  for (const section of SECTIONS) {
    list.appendChild(h('li', {}, h('a', {
      class: `nav-link${active === section.id ? ' active' : ''}`,
      href: `#/${section.id}`,
      onclick: (event) => { event.preventDefault(); go(section.id); },
    }, section.label)));
  }
  navBar.appendChild(list);
  const account = h('div', { class: 'row-actions' });
  navBar.appendChild(account);
  api.access().then((data) => {
    if (!data.login_required || !account.isConnected) return;
    account.appendChild(h('a', { class: 'btn small ghost', href: '/login', target: '_blank', rel: 'noopener' }, '重新登录'));
    account.appendChild(h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
      try { await api.logout(); location.assign('/login'); }
      catch (error) { toast(error.message, 'error'); }
    } }, '退出登录'));
  }).catch(() => {});
  navBar.appendChild(h('p', { class: 'nav-foot small muted',
    text: '网页仅做检索、编辑与浏览；科研评分与拆解由聊天 AI 依据证据写入。' }));
}

/* ------------------------------------------------------------------ *
 * 首页
 * ------------------------------------------------------------------ */

function statCard(label, value, hint, onclick) {
  return h('button', { type: 'button', class: 'stat-card', onclick },
    h('span', { class: 'stat-value', text: String(value) }),
    h('span', { class: 'stat-label', text: label }),
    hint ? h('span', { class: 'stat-hint small muted', text: hint }) : null,
  );
}

function renderHome(root) {
  const { ideas, concepts, papers } = store;
  const activeIdeas = ideas.filter((idea) => idea.status !== 'done').length;
  const reviewed = ideas.filter((idea) => idea.assessment === 'reviewed').length;
  const draft = ideas.filter((idea) => idea.assessment !== 'reviewed').length;

  root.appendChild(h('section', { class: 'page-head' },
    h('div', {},
      h('h1', { text: '总览' }),
      h('p', { class: 'page-sub muted', text: '本地记录现状、快速新建与全局检索。数据来自 research-tools/data。' }),
    ),
    h('div', { class: 'head-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.editors.idea('') }, '＋ 新增 idea'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.editors.concept('') }, '＋ 新增概念'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.editors.paper('') }, '＋ 新增文献'),
    ),
  ));

  root.appendChild(h('section', { class: 'stat-grid' },
    statCard('Idea 总数', ideas.length, `进行中 ${activeIdeas}`, () => go('ideas')),
    statCard('已评估', reviewed, draft ? `待评估 ${draft}` : '全部已评估', () => go('ideas')),
    statCard('概念', concepts.length, '按领域分组', () => go('concepts')),
    statCard('文献 / 教材', papers.length,
      `教材 ${papers.filter((p) => p.kind === 'textbook').length}`, () => go('papers')),
  ));

  const searchInput = h('input', { type: 'search', class: 'search-input', placeholder: '搜索标题、名称、别名、定义、摘要…' });
  const filter = h('select', { class: 'filter-select' },
    h('option', { value: 'all' }, '全部类型'),
    h('option', { value: 'ideas' }, 'Idea'),
    h('option', { value: 'concepts' }, '概念'),
    h('option', { value: 'papers' }, '文献'),
  );
  const results = h('div', { class: 'search-results' });

  const runSearch = () => {
    const query = searchInput.value;
    const kind = filter.value;
    clear(results);
    if (!query.trim()) {
      results.appendChild(h('p', { class: 'empty small', text: '输入关键词开始检索；空库时也会提示导入入口。' }));
      return;
    }
    const hits = [];
    if (kind === 'all' || kind === 'ideas') {
      for (const idea of ideas) {
        const haystack = [idea.title, idea.summary, (idea.tags || []).join(' '), idea.notes].join(' ');
        if (matches(haystack, query)) hits.push({ type: 'ideas', record: idea, label: 'Idea', title: idea.title, meta: STATUS_LABELS[idea.status] || idea.status });
      }
    }
    if (kind === 'all' || kind === 'concepts') {
      for (const concept of concepts) {
        const haystack = [concept.name, (concept.aliases || []).join(' '), (concept.domain || []).join(' '), concept.definition, concept.explanation].join(' ');
        if (matches(haystack, query)) hits.push({ type: 'concepts', record: concept, label: '概念', title: concept.name, meta: (concept.domain || []).join(' / ') });
      }
    }
    if (kind === 'all' || kind === 'papers') {
      for (const paper of papers) {
        const haystack = [paper.title, (paper.authors || []).join(' '), paper.abstract, paper.doi, paper.venue].join(' ');
        if (matches(haystack, query)) hits.push({ type: 'papers', record: paper, label: PAPER_KIND_LABELS[paper.kind] || '文献', title: paper.title, meta: [paper.year, paper.venue].filter(Boolean).join(' · ') });
      }
    }
    if (!hits.length) {
      results.appendChild(h('p', { class: 'empty small', text: '没有匹配记录。' }));
      return;
    }
    const list = h('ul', { class: 'result-list' });
    for (const hit of hits.slice(0, 60)) {
      list.appendChild(h('li', {},
        h('button', { type: 'button', class: 'result-item', onclick: () => go(hit.type, hit.record.id) },
          h('span', { class: `chip chip-${hit.type}` , text: hit.label }),
          h('span', { class: 'result-title', text: hit.title || '（无标题）' }),
          h('span', { class: 'result-meta small muted', text: hit.meta || '' }),
        ),
      ));
    }
    results.appendChild(list);
  };
  searchInput.addEventListener('input', runSearch);
  filter.addEventListener('change', runSearch);

  root.appendChild(h('section', { class: 'panel' },
    h('h2', { text: '全局检索' }),
    h('div', { class: 'search-bar' }, searchInput, filter),
    results,
  ));

  renderRecent(root, ideas, concepts, papers);
  renderDataPanel(root);
}

function recentRow(type, record, title, meta) {
  return h('li', {},
    h('button', { type: 'button', class: 'recent-item', onclick: () => go(type, record.id) },
      h('span', { class: 'result-title', text: title || '（无标题）' }),
      h('span', { class: 'recent-meta small muted', text: meta }),
    ),
  );
}

function renderRecent(root, ideas, concepts, papers) {
  const columns = [
    {
      heading: '最近 idea', type: 'ideas', rows: ideas.slice(0, 5),
      map: (idea) => [idea.title, `${STATUS_LABELS[idea.status] || idea.status} · 更新 ${formatTime(idea.updated_at)}`],
    },
    {
      heading: '最近概念', type: 'concepts', rows: concepts.slice(0, 5),
      map: (concept) => [concept.name, [...(concept.domain || [])].join(' / ') || '未分组'],
    },
    {
      heading: '最近文献', type: 'papers', rows: papers.slice(0, 5),
      map: (paper) => [paper.title, `${PAPER_KIND_LABELS[paper.kind] || ''} ${paper.year || ''}`.trim()],
    },
  ];
  const grid = h('section', { class: 'recent-grid' });
  for (const column of columns) {
    const list = h('ul', { class: 'recent-list' });
    if (!column.rows.length) list.appendChild(h('li', { class: 'empty small', text: '暂无记录' }));
    for (const record of column.rows) {
      const [title, meta] = column.map(record);
      list.appendChild(recentRow(column.type, record, title, meta));
    }
    grid.appendChild(h('div', { class: 'panel' },
      h('h2', {}, column.heading,
        h('button', { type: 'button', class: 'btn small ghost right', onclick: () => go(column.type) }, '查看全部')),
      list,
    ));
  }
  root.appendChild(grid);
}

async function exportData() {
  try {
    const data = await api.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `research-workbench-${store.today || 'export'}.json` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('已导出 JSON 备份（不含 PDF 文件）');
  } catch (error) {
    toast(error.message || '导出失败', 'error');
  }
}

function importData() {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (error) {
      toast('文件不是合法 JSON', 'error');
      return;
    }
    const ok = await openConfirm({
      title: '导入数据',
      message: '仅新增 id，遇到重复 id、悬空引用或非法记录会整体拒绝，不覆盖已有记录。继续吗？',
      confirmLabel: '导入',
    });
    if (!ok) return;
    try {
      const result = await api.importData(payload);
      toast(`已导入 ${result.imported} 条记录`);
      await refresh();
    } catch (error) {
      toast(error.message || '导入失败', 'error');
    }
  });
  input.click();
}

function renderDataPanel(root) {
  root.appendChild(h('section', { class: 'panel' },
    h('h2', { text: '数据' }),
    h('p', { class: 'muted small', text: 'JSON 是唯一持久层；localStorage 只存界面偏好。PDF 不随 JSON 导出，需复制 data 目录。' }),
    h('div', { class: 'head-actions' },
      h('button', { type: 'button', class: 'btn', onclick: exportData }, '导出 JSON'),
      h('button', { type: 'button', class: 'btn', onclick: importData }, '导入 JSON'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => refresh({ keepScroll: true }) }, '重新读取'),
    ),
  ));
}

/* ------------------------------------------------------------------ *
 * 编辑器接线（避免视图模块相互 import）
 * ------------------------------------------------------------------ */

ctx.editors = {
  idea: (id, options) => ideasView.openEditor(ctx, id, options),
  concept: (id) => conceptsView.openEditor(ctx, id),
  paper: (id) => papersView.openEditor(ctx, id),
  paperPicker: (options) => papersView.openPicker(ctx, options),
};

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

function boot() {
  mount = document.getElementById('view');
  navBar = document.getElementById('nav');
  window.addEventListener('hashchange', () => {
    ctx.route = parseHash();
    render();
    window.scrollTo(0, 0);
  });
  ctx.route = parseHash();
  render();
  refresh();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export { ctx };
