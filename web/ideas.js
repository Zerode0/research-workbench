// ideas.js — Idea 地图：时效性×重要性气泡、优先队列、评分理由与任务拆解。
import {
  api, h, svg, clear, toast, openConfirm, openForm, openSourcesEditor, matches,
  formatTime, sourcePdfHref, sourcePageText,
  STATUS_LABELS, ASSESSMENT_LABELS, STEP_STATUS_LABELS,
} from './ui.js';

const MAP = { width: 760, height: 540, pad: 58 };

const FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'inbox', label: '待评估' },
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'done', label: '已完成' },
];

function difficultyColor(value) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  // 青 (#2f8f8f) → 橙 (#e08a2b) → 红 (#cf4436)
  const teal = [47, 143, 143];
  const orange = [224, 138, 43];
  const red = [207, 68, 54];
  const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
  const rgb = v <= 50 ? mix(teal, orange, v / 50) : mix(orange, red, (v - 50) / 50);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function positionText(idea) {
  const urgency = Number(idea.urgency) || 0;
  const importance = Number(idea.importance) || 0;
  const difficulty = Number(idea.difficulty) || 0;
  const horizontal = urgency >= 70 ? '时效性高，应优先处理' : urgency >= 40 ? '时效性中等' : '时效性较低';
  const vertical = importance >= 70 ? '重要性高' : importance >= 40 ? '重要性中等' : '重要性较低';
  const hard = difficulty >= 70 ? '难度高，需先拆解与验证' : difficulty >= 40 ? '难度中等' : '难度较低，易启动';
  return `横轴时效性 ${urgency}（${horizontal}）；纵轴重要性 ${importance}（${vertical}）；难度 ${difficulty}（${hard}）。评分是可编辑判断，论文较新不等于项目更紧急。`;
}

function rationaleBlock(idea) {
  const rationale = idea.rationale || {};
  const rows = [
    ['时效性依据', rationale.urgency],
    ['重要性依据', rationale.importance],
    ['难度依据', rationale.difficulty],
  ];
  const missing = rows.filter(([, value]) => !String(value || '').trim()).length;
  return h('div', { class: 'rationale-block' },
    h('div', { class: 'block-head' },
      h('h3', { text: '三个评分依据' }),
      h('span', { class: `badge ${idea.assessment === 'reviewed' ? 'ok' : 'draft'}`,
        text: ASSESSMENT_LABELS[idea.assessment] || idea.assessment }),
    ),
    h('p', { class: 'muted small', text: missing
      ? `评估日期：${idea.assessed_at || '未填写'}；尚有 ${missing} 项理由为空。`
      : `评估日期：${idea.assessed_at || '未填写'}` }),
    h('dl', { class: 'rationale-list' }, rows.flatMap(([label, value]) => [
      h('dt', { text: label }),
      h('dd', { class: String(value || '').trim() ? '' : 'empty', text: String(value || '').trim() || '（待补充，由聊天 AI 依据检索证据填写）' }),
    ])),
  );
}

/* ------------------------------------------------------------------ *
 * 视图入口
 * ------------------------------------------------------------------ */

export function render(ctx, root) {
  const { store } = ctx;
  const selection = ctx.selection || {};
  const ideas = store.ideas || [];

  const searchInput = h('input', { type: 'search', class: 'search-input', placeholder: '搜索标题、摘要、标签、备注…' });
  const statusFilter = h('select', { class: 'filter-select' }, ...FILTERS.map((f) => h('option', { value: f.value }, f.label)));
  const layout = h('div', { class: 'map-layout' });

  const draw = () => {
    clear(layout);
    const query = searchInput.value;
    const status = statusFilter.value;
    const filtered = ideas.filter((idea) => {
      if (status !== 'all' && idea.status !== status) return false;
      const haystack = [idea.title, idea.summary, (idea.tags || []).join(' '), idea.notes].join(' ');
      return matches(haystack, query);
    });
    layout.appendChild(buildMap(ctx, filtered, selection));
    layout.appendChild(buildQueueAndDetail(ctx, filtered, selection));
  };
  searchInput.addEventListener('input', draw);
  statusFilter.addEventListener('change', draw);

  root.appendChild(h('section', { class: 'page-head' },
    h('div', {},
      h('h1', { text: 'Idea 地图' }),
      h('p', { class: 'page-sub muted', text: '横轴时效性 0–100（越右越优先），纵轴重要性 0–100，面积随重要性增加，颜色由难度映射青→橙→红。' }),
    ),
    h('div', { class: 'head-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.editors.idea('') }, '＋ 新增 idea'),
    ),
  ));

  root.appendChild(h('section', { class: 'panel' },
    h('div', { class: 'search-bar' }, searchInput, statusFilter,
      h('span', { class: 'muted small', text: `库内共 ${ideas.length} 条 idea` })),
  ));

  if (!ideas.length) {
    root.appendChild(emptyState(ctx));
    return;
  }
  root.appendChild(layout);
  draw();
}

function emptyState(ctx) {
  return h('section', { class: 'panel empty-state' },
    h('h2', { text: '还没有 idea 记录' }),
    h('p', { class: 'muted', text: '新 idea 默认「待评估」。评分与拆解属于科研判断，应由聊天 AI 先检索证据、解释位置后再写入；网页只负责记录与编辑。' }),
    h('div', { class: 'head-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.editors.idea('') }, '＋ 新增 idea'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => ctx.refresh({ keepScroll: true }) }, '重新读取'),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * SVG 地图
 * ------------------------------------------------------------------ */

function buildMap(ctx, ideas, selection) {
  const { width, height, pad } = MAP;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const x = (urgency) => pad + (Math.max(0, Math.min(100, urgency)) / 100) * plotW;
  const y = (importance) => height - pad - (Math.max(0, Math.min(100, importance)) / 100) * plotH;
  const radius = (importance) => 9 + (Math.max(0, Math.min(100, importance)) / 100) * 26;

  const nodes = [];
  for (let tick = 0; tick <= 100; tick += 25) {
    nodes.push(svg('line', { x1: x(tick), y1: pad, x2: x(tick), y2: height - pad, class: 'grid-line' }));
    nodes.push(svg('line', { x1: pad, y1: y(tick), x2: width - pad, y2: y(tick), class: 'grid-line' }));
    nodes.push(svg('text', { x: x(tick), y: height - pad + 20, class: 'axis-tick', 'text-anchor': 'middle', text: String(tick) }));
    nodes.push(svg('text', { x: pad - 14, y: y(tick) + 4, class: 'axis-tick', 'text-anchor': 'end', text: String(tick) }));
  }

  const bubbles = ideas.map((idea) => {
    const cx = x(Number(idea.urgency) || 0);
    const cy = y(Number(idea.importance) || 0);
    const r = radius(Number(idea.importance) || 0);
    const selected = selection.ideas === idea.id;
    const group = svg('g', { class: `bubble${selected ? ' selected' : ''}`, tabindex: '0', role: 'button',
      'aria-label': `${idea.title}（时效性 ${idea.urgency}，重要性 ${idea.importance}）`,
      onclick: () => selectIdea(ctx, idea.id), onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectIdea(ctx, idea.id); }
      } },
      svg('circle', { cx, cy, r, fill: difficultyColor(idea.difficulty), class: 'bubble-dot',
        opacity: idea.status === 'done' ? '0.55' : '0.88' }),
      svg('title', { text: `${idea.title}｜时效性 ${idea.urgency}｜重要性 ${idea.importance}｜难度 ${idea.difficulty}｜${STATUS_LABELS[idea.status] || idea.status}` }),
    );
    if (r >= 16) {
      group.appendChild(svg('text', { x: cx, y: cy + 4, class: 'bubble-label', 'text-anchor': 'middle',
        text: truncate(idea.title || '（无标题）', Math.round(r / 6.4)) }));
    }
    return group;
  });

  return h('div', { class: 'panel map-panel' },
    h('div', { class: 'map-head' },
      h('h2', { text: '优先地图' }),
      legend(),
    ),
    svg('svg', { class: 'idea-map', viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': 'Idea 时效性与重要性分布图', preserveAspectRatio: 'xMidYMid meet' },
      svg('rect', { x: pad, y: pad, width: plotW, height: plotH, class: 'plot-area' }),
      ...nodes,
      svg('text', { x: width - pad, y: height - 12, class: 'axis-title', 'text-anchor': 'end', text: '时效性 →' }),
      svg('text', { x: 16, y: pad - 30, class: 'axis-title', 'text-anchor': 'start', text: '↑ 重要性' }),
      ...bubbles,
    ),
    h('p', { class: 'muted small', text: '气泡面积随重要性增大，颜色随难度由青转红；点击气泡查看详情。' }),
  );
}

function truncate(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 1)) + '…';
}

function legend() {
  const stops = [0, 25, 50, 75, 100];
  return h('div', { class: 'legend' },
    h('span', { class: 'small muted', text: '难度' }),
    ...stops.map((value) => h('span', { class: 'legend-swatch', style: { background: difficultyColor(value) }, title: String(value) })),
    h('span', { class: 'small muted', text: '100' }),
  );
}

/* ------------------------------------------------------------------ *
 * 优先队列与详情
 * ------------------------------------------------------------------ */

function buildQueueAndDetail(ctx, ideas, selection) {
  const queue = [...ideas].sort((a, b) =>
    (Number(b.urgency) || 0) - (Number(a.urgency) || 0) || (Number(b.importance) || 0) - (Number(a.importance) || 0));
  const list = h('ol', { class: 'queue-list' });
  queue.forEach((idea, index) => {
    list.appendChild(h('li', {},
      h('button', { type: 'button', class: `queue-item${selection.ideas === idea.id ? ' active' : ''}`,
        onclick: () => selectIdea(ctx, idea.id) },
        h('span', { class: 'queue-rank', text: String(index + 1) }),
        h('span', { class: 'queue-main' },
          h('span', { class: 'queue-title', text: idea.title || '（无标题）' }),
          h('span', { class: 'small muted', text: `时效 ${idea.urgency} · 重要 ${idea.importance} · 难度 ${idea.difficulty} · ${STATUS_LABELS[idea.status] || idea.status}` }),
        ),
        h('span', { class: `dot-status dot-${idea.status}` , title: STATUS_LABELS[idea.status] || '' }),
      )));
  });

  const column = h('div', { class: 'queue-column' },
    h('section', { class: 'panel' },
      h('h2', { text: '优先队列' }),
      h('p', { class: 'muted small', text: '先按时效性、再按重要性排序。' }),
      queue.length ? list : h('p', { class: 'empty small', text: '当前筛选无记录。' }),
    ),
  );
  const selected = ideas.find((idea) => idea.id === selection.ideas) || null;
  column.appendChild(selected ? buildDetail(ctx, selected) : h('section', { class: 'panel detail-panel' },
    h('h2', { text: '详情' }),
    h('p', { class: 'empty small', text: '点击地图气泡或队列条目查看评分理由、证据文献与任务拆解。' }),
  ));
  return column;
}

function selectIdea(ctx, id) {
  ctx.selection.ideas = ctx.selection.ideas === id ? '' : id;
  ctx.render();
}

function buildDetail(ctx, idea) {
  const papers = ctx.store.papers || [];
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const sources = Array.isArray(idea.sources) ? idea.sources : [];
  const steps = Array.isArray(idea.steps) ? idea.steps : [];

  const panel = h('section', { class: 'panel detail-panel' });
  panel.appendChild(h('div', { class: 'detail-head' },
    h('div', {},
      h('h2', { text: idea.title || '（无标题）' }),
      h('div', { class: 'chip-row' },
        h('span', { class: `chip status-${idea.status}`, text: STATUS_LABELS[idea.status] || idea.status }),
        h('span', { class: `chip assessment-${idea.assessment}`, text: ASSESSMENT_LABELS[idea.assessment] || idea.assessment }),
        ...(idea.tags || []).map((tag) => h('span', { class: 'chip', text: tag })),
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => ctx.editors.idea(idea.id) }, '编辑'),
      h('button', { type: 'button', class: 'btn small danger-ghost', onclick: () => removeIdea(ctx, idea) }, '删除'),
    ),
  ));

  panel.appendChild(h('p', { class: 'muted small', text: `id ${idea.id} · 版本 ${idea.revision} · 更新 ${formatTime(idea.updated_at)}` }));
  if (idea.deadline) panel.appendChild(h('p', { class: 'small', text: `截止：${idea.deadline}` }));

  // 评分理由靠前显示。
  panel.appendChild(rationaleBlock(idea));
  panel.appendChild(h('div', { class: 'block' },
    h('h3', { text: '位置说明' }),
    h('p', { text: positionText(idea) }),
  ));

  if (idea.summary) panel.appendChild(h('div', { class: 'block' }, h('h3', { text: '摘要' }), h('p', { text: idea.summary })));

  panel.appendChild(h('div', { class: 'block' },
    h('div', { class: 'block-head' },
      h('h3', { text: `证据文献（${sources.length}）` }),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => ctx.editors.idea(idea.id, { focusSources: true }) }, '编辑出处'),
    ),
    sources.length ? h('ul', { class: 'source-list' }, sources.map((source) => {
      const paper = paperById.get(source.paper_id) || null;
      const href = sourcePdfHref(paper, source);
      return h('li', { class: 'source-row' },
        h('div', { class: 'source-main' },
          paper
            ? h('button', { type: 'button', class: 'link-button source-link', onclick: () => ctx.go('papers', paper.id) },
              h('span', { class: 'source-title', text: paper.title }))
            : h('p', { class: 'source-title', text: `未知文献 ${source.paper_id}` }),
          h('p', { class: 'muted small', text: sourcePageText(source) || '未填写页码' }),
          source.verified_page ? h('span', { class: 'badge ok', text: '页码已核实' }) : h('span', { class: 'badge warn', text: '页码待核实' }),
        ),
        href ? h('a', { class: 'btn small ghost', href, target: '_blank', rel: 'noopener' }, '查看 PDF') : null,
      );
    })) : h('p', { class: 'empty small', text: '暂无出处；请在编辑器中关联已保存的文献。' }),
  ));

  const unverified = sources.filter((source) => !source.verified_page || !(Number.isInteger(source.page) && source.page > 0));
  panel.appendChild(h('div', { class: 'block' },
    h('h3', { text: '待核实项' }),
    unverified.length
      ? h('ul', { class: 'plain-list' }, unverified.map((source) => {
        const paper = paperById.get(source.paper_id) || null;
        return h('li', { text: `${paper ? paper.title : source.paper_id}：${source.verified_page ? '已核实但缺物理页码' : '页码尚未人工核实'}` });
      }))
      : h('p', { class: 'muted small', text: '所有出处页码均已核实（或暂无出处）。' }),
    idea.assessment !== 'reviewed'
      ? h('p', { class: 'muted small', text: '该 idea 仍为评估草稿：评分理由可能来自聊天 AI 的初步判断。' })
      : null,
  ));

  panel.appendChild(buildStepsBlock(ctx, idea, steps, paperById));
  if (idea.notes) panel.appendChild(h('div', { class: 'block' }, h('h3', { text: '备注' }), h('p', { text: idea.notes })));
  return panel;
}

function buildStepsBlock(ctx, idea, steps, paperById) {
  const list = h('ul', { class: 'step-list' });
  if (!steps.length) {
    list.appendChild(h('li', { class: 'empty small', text: '暂无任务拆解。可手动新增，或使用「生成草稿拆解」由服务创建三个可编辑草稿步骤。' }));
  }
  const ids = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    const deps = (step.depends_on || []).filter((dep) => ids.has(dep));
    list.appendChild(h('li', { class: `step-item step-${step.status || 'todo'}` },
      h('div', { class: 'step-head' },
        h('span', { class: `dot-status dot-${step.status || 'todo'}` }),
        h('span', { class: 'step-title', text: step.title || '（未命名步骤）' }),
        h('span', { class: 'badge', text: `${step.days} 工作日` }),
        h('span', { class: 'badge', text: STEP_STATUS_LABELS[step.status] || step.status || '待办' }),
      ),
      h('p', { class: 'small muted', text: `id ${step.id}${deps.length ? ' · 依赖 ' + deps.join('、') : ''}` }),
      step.deliverable ? h('p', { class: 'small', text: `交付物：${step.deliverable}` }) : null,
      step.acceptance ? h('p', { class: 'small', text: `验收：${step.acceptance}` }) : null,
    ));
  }
  return h('div', { class: 'block' },
    h('div', { class: 'block-head' },
      h('h3', { text: `任务拆解（${steps.length}）` }),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn small', onclick: async () => {
          const edited = await editSteps(ctx, idea, steps);
          if (edited === null) return;
          try {
            await api.patch('ideas', idea.id, { revision: idea.revision, steps: edited });
            toast('任务步骤已保存');
            await ctx.refresh({ keepScroll: true });
          } catch (error) {
            toast(error.status === 409 ? `${error.message} 请重新读取后合并编辑。` : error.message, 'error');
          }
        } }, '编辑步骤'),
        !steps.length ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => decompose(ctx, idea) }, '生成草稿拆解') : null,
      ),
    ),
    h('p', { class: 'muted small', text: '每步 1–3 个工作日；草稿模板需替换为具体科研内容，法定节假日暂不计入。' }),
    list,
  );
}

/* ------------------------------------------------------------------ *
 * 动作
 * ------------------------------------------------------------------ */

async function removeIdea(ctx, idea) {
  const ok = await openConfirm({
    title: '删除 idea',
    message: `确认删除「${idea.title || idea.id}」？删除后旧版本保存在 .history，不可在网页恢复。`,
    confirmLabel: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.remove('ideas', idea.id, idea.revision);
    if (ctx.selection.ideas === idea.id) ctx.selection.ideas = '';
    toast('已删除 idea');
    await ctx.refresh({ keepScroll: true });
  } catch (error) {
    if (error.status === 409) {
      toast(`${error.message} 请重新读取后再操作。`, 'error');
      await ctx.refresh({ keepScroll: true });
    } else {
      toast(error.message || '删除失败', 'error');
    }
  }
}

async function decompose(ctx, idea) {
  try {
    await api.decompose(idea.id, idea.revision);
    toast('已生成三个草稿步骤，请替换为具体科研内容');
    await ctx.refresh({ keepScroll: true });
  } catch (error) {
    if (error.status === 409) {
      toast(`${error.message}`, 'error');
      await ctx.refresh({ keepScroll: true });
    } else {
      toast(error.message || '生成拆解失败', 'error');
    }
  }
}

/* ------------------------------------------------------------------ *
 * 任务步骤编辑器
 * ------------------------------------------------------------------ */

function editSteps(ctx, idea, steps) {
  return new Promise((resolve) => {
    const list = steps.map((step) => ({
      id: step.id || '',
      title: step.title || '',
      days: Number.isInteger(step.days) ? step.days : 1,
      status: step.status || 'todo',
      deliverable: step.deliverable || '',
      acceptance: step.acceptance || '',
      depends_on: Array.isArray(step.depends_on) ? [...step.depends_on] : [],
    }));
    let resolved = false;
    const dialog = h('dialog', { class: 'dialog dialog-wide' });
    const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
    const body = h('div', { class: 'dialog-body' });
    const save = h('button', { type: 'button', class: 'btn primary', text: '保存步骤' });
    const cancel = h('button', { type: 'button', class: 'btn ghost', text: '取消' });
    const add = h('button', { type: 'button', class: 'btn', text: '新增步骤' });
    const form = h('form', { class: 'dialog-form', novalidate: true },
      h('header', { class: 'dialog-head' }, h('h2', { class: 'dialog-title', text: `编辑步骤 · ${idea.title || idea.id}` })),
      h('p', { class: 'dialog-desc', text: '每步 1–3 个工作日；依赖只能指向本 idea 内的步骤 id，且不能成环。' }),
      error, body,
      h('footer', { class: 'dialog-foot' }, add, cancel, save),
    );
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    const finish = (value) => { resolved = true; if (dialog.open) dialog.close(); dialog.remove(); resolve(value); };
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dialog.addEventListener('close', () => { if (!resolved) resolve(null); });

    const usedIds = () => new Set(list.map((step) => step.id).filter(Boolean));

    const redraw = () => {
      clear(body);
      if (!list.length) body.appendChild(h('p', { class: 'empty small', text: '暂无步骤。' }));
      list.forEach((step, index) => {
        const card = h('div', { class: 'step-editor' });
        card.appendChild(h('div', { class: 'step-editor-head' },
          h('strong', { text: `步骤 ${index + 1}` }),
          h('button', { type: 'button', class: 'btn small danger-ghost', text: '删除',
            onclick: () => { list.splice(index, 1); redraw(); } }),
        ));
        const field = (label, node) => h('div', { class: 'form-row compact' }, h('label', { class: 'form-label', text: label }), node);
        const idInput = h('input', { type: 'text', value: step.id, placeholder: '小写字母/数字/短横线' });
        idInput.addEventListener('input', () => { step.id = idInput.value.trim(); });
        const titleInput = h('input', { type: 'text', value: step.title });
        titleInput.addEventListener('input', () => { step.title = titleInput.value; });
        const daysInput = h('input', { type: 'number', min: '1', max: '3', step: '1', value: String(step.days) });
        daysInput.addEventListener('input', () => { step.days = Number(daysInput.value); });
        const statusSelect = h('select', {},
          h('option', { value: 'todo' }, '待办'), h('option', { value: 'doing' }, '进行中'), h('option', { value: 'done' }, '已完成'));
        statusSelect.value = step.status;
        statusSelect.addEventListener('change', () => { step.status = statusSelect.value; });
        const deliverable = h('textarea', { rows: '2' }); deliverable.value = step.deliverable;
        deliverable.addEventListener('input', () => { step.deliverable = deliverable.value; });
        const acceptance = h('textarea', { rows: '2' }); acceptance.value = step.acceptance;
        acceptance.addEventListener('input', () => { step.acceptance = acceptance.value; });
        const depsSelect = h('select', { multiple: true, size: '3' });
        const refreshDeps = () => {
          clear(depsSelect);
          for (const candidate of usedIds()) {
            if (candidate === step.id) continue;
            const option = h('option', { value: candidate }, candidate);
            if (step.depends_on.includes(candidate)) option.selected = true;
            depsSelect.appendChild(option);
          }
        };
        refreshDeps();
        depsSelect.addEventListener('change', () => {
          step.depends_on = Array.from(depsSelect.selectedOptions).map((option) => option.value);
        });
        card.appendChild(h('div', { class: 'grid-2' },
          field('步骤 id', idInput),
          field('标题', titleInput),
        ));
        card.appendChild(h('div', { class: 'grid-2' },
          field('工作日（1–3）', daysInput),
          field('状态', statusSelect),
        ));
        card.appendChild(field('交付物', deliverable));
        card.appendChild(field('验收标准', acceptance));
        card.appendChild(field('依赖步骤', depsSelect));
        body.appendChild(card);
        if (index === list.length - 1) {
          idInput.addEventListener('blur', refreshDeps);
        }
      });
    };

    add.addEventListener('click', () => {
      list.push({ id: '', title: '', days: 1, status: 'todo', deliverable: '', acceptance: '', depends_on: [] });
      redraw();
    });
    save.addEventListener('click', () => {
      error.hidden = true;
      const seen = new Set();
      for (const step of list) {
        if (!step.id) { error.textContent = '每个步骤都需要 id'; error.hidden = false; return; }
        if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(step.id)) { error.textContent = `步骤 id 不合法：${step.id}`; error.hidden = false; return; }
        if (seen.has(step.id)) { error.textContent = `步骤 id 重复：${step.id}`; error.hidden = false; return; }
        seen.add(step.id);
        if (!step.title.trim()) { error.textContent = `步骤 ${step.id} 缺少标题`; error.hidden = false; return; }
        if (!Number.isInteger(step.days) || step.days < 1 || step.days > 3) { error.textContent = `步骤 ${step.id} 的工作日必须为 1–3`; error.hidden = false; return; }
        for (const dep of step.depends_on) {
          if (!seen.has(dep) && !list.some((item) => item.id === dep)) { error.textContent = `步骤 ${step.id} 依赖了不存在的步骤 ${dep}`; error.hidden = false; return; }
        }
      }
      finish(list.map((step) => ({
        id: step.id, title: step.title.trim(), days: step.days, status: step.status,
        deliverable: step.deliverable, acceptance: step.acceptance, depends_on: step.depends_on,
      })));
    });
    redraw();
    dialog.showModal();
  });
}

/* ------------------------------------------------------------------ *
 * 编辑对话框
 * ------------------------------------------------------------------ */

export function openEditor(ctx, id, options = {}) {
  const existing = id ? ctx.store.ideas.find((idea) => idea.id === id) : null;
  if (id && !existing) { toast('记录不存在，请重新读取', 'error'); return; }
  const base = existing || {
    id: '', title: '', summary: '', status: 'inbox', urgency: 50, importance: 50, difficulty: 50,
    assessment: 'draft', rationale: { urgency: '', importance: '', difficulty: '' }, assessed_at: '',
    deadline: '', sources: [], tags: [], steps: [], notes: '', revision: 0,
  };
  const rationale = base.rationale || {};

  const sourcesRef = { value: base.sources || [] };
  const stepsRef = { value: base.steps || [] };
  let sourcesAreaRef = null;
  let stepsAreaRef = null;

  openForm({
    title: existing ? `编辑 idea · ${existing.title || existing.id}` : '新增 idea',
    description: existing
      ? '保存需附带原 revision；若他处已修改将返回冲突，不会静默覆盖。'
      : '新 idea 默认「待评估」；评分理由应来自检索证据，而非模板推导。',
    wide: true,
    values: {
      title: base.title, status: base.status, summary: base.summary,
      urgency: base.urgency, importance: base.importance, difficulty: base.difficulty,
      assessment: base.assessment, assessed_at: base.assessed_at, deadline: base.deadline,
      r_urgency: rationale.urgency || '', r_importance: rationale.importance || '', r_difficulty: rationale.difficulty || '',
      tags: base.tags || [], notes: base.notes,
    },
    fields: [
      { name: 'title', label: '标题', type: 'text', required: true },
      { name: 'status', label: '状态', type: 'select', options: FILTERS.filter((f) => f.value !== 'all').map((f) => ({ value: f.value, label: f.label })) },
      { name: 'summary', label: '摘要', type: 'textarea', rows: 3 },
      { name: 'urgency', label: '时效性 (0–100)', type: 'number', min: 0, max: 100, integer: true, required: true },
      { name: 'importance', label: '重要性 (0–100)', type: 'number', min: 0, max: 100, integer: true, required: true },
      { name: 'difficulty', label: '难度 (0–100)', type: 'number', min: 0, max: 100, integer: true, required: true },
      { name: 'assessment', label: '评估状态', type: 'select', options: [
        { value: 'draft', label: '评估草稿' }, { value: 'reviewed', label: '已评估' },
      ] },
      { name: 'assessed_at', label: '评估日期', type: 'date', help: '已评估时必填（YYYY-MM-DD）。' },
      { name: 'deadline', label: '截止日期', type: 'date', help: '可留空。' },
      { group: '评分理由（已评估时三项必填）', name: 'r_urgency', label: '时效性依据', type: 'textarea', rows: 2 },
      { name: 'r_importance', label: '重要性依据', type: 'textarea', rows: 2 },
      { name: 'r_difficulty', label: '难度依据', type: 'textarea', rows: 2 },
      { name: 'tags', label: '标签', type: 'list', help: '每行一个，或用逗号分隔。' },
      { name: 'notes', label: '备注', type: 'textarea', rows: 3 },
    ],
    renderBefore: (parts) => {
      const box = h('div', { class: 'editor-extra' });
      const sourcesArea = h('textarea', { class: 'mono json-area', rows: '5' });
      sourcesArea.value = JSON.stringify(sourcesRef.value, null, 2);
      const stepsArea = h('textarea', { class: 'mono json-area', rows: '6' });
      stepsArea.value = JSON.stringify(stepsRef.value, null, 2);
      sourcesAreaRef = sourcesArea;
      stepsAreaRef = stepsArea;
      const sync = () => {
        sourcesArea.value = JSON.stringify(sourcesRef.value, null, 2);
        stepsArea.value = JSON.stringify(stepsRef.value, null, 2);
      };
      box.appendChild(h('p', { class: 'form-group', text: '出处与任务拆解' }));
      box.appendChild(h('div', { class: 'form-row' },
        h('label', { class: 'form-label' }, 'sources（出处 JSON）'),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn small', text: '结构化编辑出处', onclick: async () => {
            try {
              sourcesRef.value = JSON.parse(sourcesArea.value);
              if (!Array.isArray(sourcesRef.value)) throw new Error('出处须为数组');
            } catch (error) { toast(`出处 JSON 无效：${error.message}`, 'error'); return; }
            const next = await openSourcesEditor({ sources: sourcesRef.value, papers: ctx.store.papers || [] });
            if (next) { sourcesRef.value = next; sourcesArea.value = JSON.stringify(next, null, 2); }
          } }),
        ),
        h('details', { class: 'advanced-fields' }, h('summary', { text: '高级：出处 JSON' }), sourcesArea),
        h('p', { class: 'form-help', text: '数组字段在此用 JSON 文本域编辑；保存时整体替换。' }),
      ));
      box.appendChild(h('div', { class: 'form-row' },
        h('label', { class: 'form-label' }, 'steps（步骤 JSON）'),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn small', text: '结构化编辑步骤', onclick: async () => {
            try {
              stepsRef.value = JSON.parse(stepsArea.value);
              if (!Array.isArray(stepsRef.value)) throw new Error('步骤须为数组');
            } catch (error) { toast(`步骤 JSON 无效：${error.message}`, 'error'); return; }
            const next = await editSteps(ctx, base, stepsRef.value);
            if (next) { stepsRef.value = next; stepsArea.value = JSON.stringify(next, null, 2); }
          } }),
        ),
        h('details', { class: 'advanced-fields' }, h('summary', { text: '高级：步骤 JSON' }), stepsArea),
        h('p', { class: 'form-help', text: '每步 days 为 1–3；依赖 depends_on 指向步骤 id。' }),
      ));
      box.dataset.sources = '1';
      return box;
    },
    onSubmit: async (values) => {
      let sources;
      let steps;
      try {
        sources = JSON.parse(sourcesAreaRef ? sourcesAreaRef.value : '[]');
        steps = JSON.parse(stepsAreaRef ? stepsAreaRef.value : '[]');
      } catch (error) {
        throw new Error(`JSON 解析失败：${error.message}`);
      }
      if (!Array.isArray(sources) || !Array.isArray(steps)) throw new Error('sources 和 steps 必须是数组');
      const rationale = { urgency: values.r_urgency, importance: values.r_importance, difficulty: values.r_difficulty };
      if (values.assessment === 'reviewed') {
        if (!values.assessed_at) throw new Error('已评估 idea 必须填写评估日期');
        if (![rationale.urgency, rationale.importance, rationale.difficulty].every((text) => String(text || '').trim())) {
          throw new Error('已评估 idea 必须提供三个评分理由');
        }
      }
      const payload = {
        title: values.title, status: values.status, summary: values.summary,
        urgency: values.urgency, importance: values.importance, difficulty: values.difficulty,
        assessment: values.assessment, assessed_at: values.assessed_at, deadline: values.deadline,
        rationale, sources, steps, tags: values.tags, notes: values.notes,
      };
      if (!existing) payload.id = slugOrEmpty(values.title);
      try {
        if (existing) {
          await api.patch('ideas', existing.id, { revision: existing.revision, ...payload });
          toast('已保存 idea');
        } else {
          await api.create('ideas', payload);
          toast('已创建 idea');
        }
        await ctx.refresh({ keepScroll: true });
      } catch (error) {
        if (error.status === 409) {
          throw new Error(`${error.message} 建议关闭对话框并重新读取后再编辑。`);
        }
        throw error;
      }
    },
  });
}

function slugOrEmpty(title) {
  const slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return /^[a-z0-9][a-z0-9_-]*$/.test(slug) ? slug : '';
}
