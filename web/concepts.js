// concepts.js — 概念解释、关系与来源；分类树单独维护于 concept-tree.js。
import { renderConceptTree, openCategoryEditor, parseDomainPath } from './concept-tree.js';
import {
  api, h, svg, clear, toast, openConfirm, openForm, openSourcesEditor, matches, mathContent,
  formatTime, sourcePdfHref, sourcePageText,
  RELATION_LABELS, RELATION_HINT,
} from './ui.js';

const RELATION_ORDER = ['prerequisite', 'related', 'mentioned', 'referenced_by'];

/* ------------------------------------------------------------------ *
 * 视图入口
 * ------------------------------------------------------------------ */

export function render(ctx, root) {
  const { store } = ctx;
  const selection = ctx.selection || {};
  const concepts = store.concepts || [];
  const papers = store.papers || [];
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));

  const searchInput = h('input', { type: 'search', class: 'search-input', placeholder: '搜索名称、别名、定义、解释…' });
  const results = h('div', { class: 'concept-layout' });

  const draw = () => {
    clear(results);
    const query = searchInput.value;
    const filtered = concepts.filter((concept) => matches(
      [concept.name, (concept.aliases || []).join(' '), (concept.domain || []).join(' '), concept.definition, concept.explanation].join(' '),
      query,
    ));
    results.appendChild(renderConceptTree(ctx, filtered, selection.concepts, {
      searching: Boolean(query.trim()), onSelect: id => selectConcept(ctx, id),
    }));
    results.appendChild(buildDetailColumn(ctx, filtered, selection, paperById));
  };
  searchInput.addEventListener('input', draw);

  root.appendChild(h('section', { class: 'page-head' },
    h('div', {},
      h('h1', { text: '概念学习' }),
      h('p', { class: 'page-sub muted', text: '知识范畴以分类树逐级展开；点击概念查看解释、相关概念和论文出处。' }),
    ),
    h('div', { class: 'head-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.editors.concept('') }, '＋ 新增概念'),
    ),
  ));

  root.appendChild(h('section', { class: 'panel' },
    h('div', { class: 'search-bar' }, searchInput,
      h('span', { class: 'muted small', text: `库内共 ${concepts.length} 个概念` })),
  ));

  if (!concepts.length) {
    root.appendChild(h('section', { class: 'panel empty-state' },
      h('h2', { text: '还没有概念记录' }),
      h('p', { class: 'muted', text: '概念由聊天 AI 在解释时按需创建；网页不凭字符串匹配生成定义。' }),
      h('div', { class: 'head-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.editors.concept('') }, '＋ 新增概念'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => ctx.refresh({ keepScroll: true }) }, '重新读取'),
      ),
    ));
    return;
  }
  root.appendChild(results);
  draw();
}

/* ------------------------------------------------------------------ *
 * 概念选择
 * ------------------------------------------------------------------ */

function selectConcept(ctx, id) {
  ctx.selection.concepts = ctx.selection.concepts === id ? '' : id;
  ctx.render();
}

/* ------------------------------------------------------------------ *
 * 详情列
 * ------------------------------------------------------------------ */

function buildDetailColumn(ctx, concepts, selection, paperById) {
  const column = h('div', { class: 'detail-column' });
  const selected = concepts.find((concept) => concept.id === selection.concepts) || null;
  if (!selected) {
    column.appendChild(h('section', { class: 'panel detail-panel' },
      h('h2', { text: '概念详情' }),
      h('p', { class: 'empty small', text: '选择左侧概念查看定义、关系、来源与候选文献。' }),
    ));
    return column;
  }
  column.appendChild(buildDetail(ctx, selected, paperById));
  return column;
}

function buildDetail(ctx, concept, paperById) {
  const panel = h('section', { class: 'panel detail-panel' });
  const aliases = (concept.aliases || []).filter(Boolean);

  panel.appendChild(h('div', { class: 'detail-head' },
    h('div', {},
      h('h2', { text: concept.name || '（未命名）' }),
      h('div', { class: 'chip-row' },
        ...(concept.domain || []).map((part) => h('span', { class: 'chip', text: part })),
        ...(concept.tags || []).map((tag) => h('span', { class: 'chip', text: tag })),
      ),
      aliases.length ? h('p', { class: 'muted small', text: `别名：${aliases.join('、')}` }) : null,
    ),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => ctx.editors.concept(concept.id) }, '编辑'),
      h('button', { type: 'button', class: 'btn small', onclick: () => openCategoryEditor(ctx, concept.id) }, '修改分类'),
      h('button', { type: 'button', class: 'btn small danger-ghost', onclick: () => removeConcept(ctx, concept) }, '删除'),
    ),
  ));
  panel.appendChild(h('p', { class: 'muted small', text: `id ${concept.id} · 版本 ${concept.revision} · 更新 ${formatTime(concept.updated_at)}` }));

  panel.appendChild(h('div', { class: 'block' }, h('h3', { text: '定义' }),
    concept.definition ? mathContent(concept.definition) : h('p', { class: 'empty small', text: '暂无定义。' })));

  if (concept.explanation) {
    panel.appendChild(h('div', { class: 'block' }, h('h3', { text: '解释' }), mathContent(concept.explanation)));
  }

  const relationsBox = h('div', { class: 'block', id: 'relations-box' },
    h('div', { class: 'block-head' },
      h('h3', { text: '关系' }),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => editRelations(ctx, concept) }, '编辑显式关系'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => loadRelations(ctx, concept, relationsBox, paperById) }, '刷新'),
      ),
    ),
    h('p', { class: 'muted small', text: '显式 prerequisite / related 与自动识别的「解释中提到」关系分开显示；关键词匹配不构成引用证据。' }),
    h('p', { class: 'loading small muted', text: '正在读取关系…' }),
  );
  panel.appendChild(relationsBox);
  loadRelations(ctx, concept, relationsBox, paperById);

  const sources = Array.isArray(concept.sources) ? concept.sources : [];
  panel.appendChild(h('div', { class: 'block' },
    h('div', { class: 'block-head' },
      h('h3', { text: `来源论文或教材（${sources.length}）` }),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => ctx.editors.concept(concept.id) }, '编辑出处'),
    ),
    h('p', { class: 'muted small', text: '用户明确引用的来源单独展示；页码仅在核实后才跳转。' }),
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
        ),
        href ? h('a', { class: 'btn small ghost', href, target: '_blank', rel: 'noopener' }, '查看 PDF') : null,
      );
    })) : h('p', { class: 'empty small', text: '暂无来源。' }),
  ));

  panel.appendChild(h('div', { class: 'block' },
    h('h3', { text: '新增出处' }),
    h('p', { class: 'muted small', text: '来源需引用文献库中已保存的记录。' }),
    h('button', { type: 'button', class: 'btn small', onclick: async () => {
      const next = await openSourcesEditor({ sources, papers: ctx.store.papers || [], title: '编辑来源' });
      if (!next) return;
      try {
        await api.patch('concepts', concept.id, { revision: concept.revision, sources: next });
        toast('已保存来源');
        await ctx.refresh({ keepScroll: true });
      } catch (error) {
        toast(error.status === 409 ? `${error.message} 请重新读取后合并编辑。` : (error.message || '保存失败'), 'error');
      }
    } }, '编辑来源列表'),
  ));

  if (concept.notes) panel.appendChild(h('div', { class: 'block' }, h('h3', { text: '备注' }), h('p', { text: concept.notes })));
  return panel;
}

async function loadRelations(ctx, concept, box, paperById) {
  box.querySelector('.loading')?.remove();
  const slots = [...box.querySelectorAll('.relations-slot')];
  slots.forEach((node) => node.remove());
  try {
    const data = await api.relations(concept.id);
    const container = h('div', { class: 'relations-slot' });
    const groups = new Map(RELATION_ORDER.map((type) => [type, []]));
    for (const item of data.concepts || []) {
      if (!groups.has(item.type)) groups.set(item.type, []);
      groups.get(item.type).push(item);
    }
    let any = false;
    for (const type of RELATION_ORDER) {
      const items = groups.get(type) || [];
      if (!items.length) continue;
      any = true;
      container.appendChild(h('div', { class: `relation-group rel-${type}` },
        h('h4', { text: RELATION_LABELS[type] || type }),
        h('p', { class: 'muted small', text: RELATION_HINT[type] || '' }),
        h('ul', { class: 'relation-list' }, items.map((item) => h('li', {},
          h('button', { type: 'button', class: 'link-button', onclick: () => selectConcept(ctx, item.id) },
            h('span', { class: 'relation-name', text: item.name || item.id }),
            h('span', { class: 'small muted', text: item.reason || '' }),
          ),
        ))),
      ));
    }
    if (!any) container.appendChild(h('p', { class: 'empty small', text: '暂无概念关系。' }));

    const graph = buildRelationGraph(ctx, concept, data.concepts || []);
    if (graph) container.appendChild(graph);
    container.appendChild(buildPaperCandidates(ctx, concept, data.papers || [], paperById));
    box.appendChild(container);
  } catch (error) {
    box.appendChild(h('div', { class: 'relations-slot' },
      h('p', { class: 'small error-text', text: `关系读取失败：${error.message || '未知错误'}` })));
  }
}

function buildRelationGraph(ctx, concept, relations) {
  if (!relations.length) return null;
  const width = 520;
  const height = 320;
  const cx = width / 2;
  const cy = height / 2;
  const inner = Math.min(110, 34 + relations.length * 8);
  const nodes = relations.slice(0, 14);
  const groups = [];
  nodes.forEach((item, index) => {
    const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
    const nx = cx + Math.cos(angle) * Math.min(180, inner * 1.9);
    const ny = cy + Math.sin(angle) * Math.min(112, inner * 1.5);
    groups.push(svg('line', { x1: cx, y1: cy, x2: nx, y2: ny, class: `rel-line rel-${item.type}` }));
    groups.push(svg('g', {
      class: 'relation-link', role: 'button', tabindex: '0', style: 'cursor:pointer',
      'aria-label': `查看概念：${item.name || item.id}`,
      onclick: () => selectConcept(ctx, item.id),
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); selectConcept(ctx, item.id);
        }
      },
    },
      svg('circle', { cx: nx, cy: ny, r: 14, fill: 'transparent' }),
      svg('circle', { cx: nx, cy: ny, r: 6, class: `rel-node rel-${item.type}` }),
      svg('text', { x: nx, y: ny - 10, class: 'rel-label', 'text-anchor': 'middle',
        text: String(item.name || item.id).slice(0, 14) }),
    ));
  });
  return h('div', { class: 'relation-graph' },
    h('h4', { text: '关系图' }),
    svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': `以 ${concept.name} 为中心的关系图`, preserveAspectRatio: 'xMidYMid meet' },
      ...groups,
      svg('circle', { cx, cy, r: 12, class: 'rel-center' }),
      svg('text', { x: cx, y: cy + 26, class: 'rel-center-label', 'text-anchor': 'middle',
        text: String(concept.name || concept.id).slice(0, 16) }),
    ),
    h('p', { class: 'muted small', text: '实线来自显式关系，虚线来自自动识别，仅作提示。' }),
  );
}

function buildPaperCandidates(ctx, concept, papers, paperById) {
  const sources = new Set((concept.sources || []).map((source) => source.paper_id));
  const sourceItems = papers.filter((item) => item.type === 'source');
  const candidates = papers.filter((item) => item.type === 'candidate');
  const box = h('div', { class: 'relation-group candidates' },
    h('h4', { text: '关联文献' }),
    h('p', { class: 'muted small', text: '候选仅表示标题或摘要关键词匹配，不等于引用证据；确认相关性后再加入来源。' }),
  );
  if (sourceItems.length) {
    box.appendChild(h('h5', { text: '已指定来源' }));
    box.appendChild(h('ul', { class: 'relation-list' }, sourceItems.map((item) => h('li', {},
      h('button', { type: 'button', class: 'link-button', onclick: () => ctx.go('papers', item.id) },
        h('span', { class: 'relation-name', text: item.title || item.id }),
        h('span', { class: 'small muted', text: item.reason || '' }),
      ),
    ))));
  }
  if (!candidates.length) {
    box.appendChild(h('p', { class: 'empty small', text: '暂无关键词匹配候选。' }));
    return box;
  }
  box.appendChild(h('h5', { text: '关键词匹配候选' }));
  box.appendChild(h('ul', { class: 'relation-list' }, candidates.map((item) => {
    const already = sources.has(item.id);
    return h('li', { class: 'candidate-row' },
      h('div', { class: 'candidate-main' },
        h('button', { type: 'button', class: 'link-button', onclick: () => ctx.go('papers', item.id) },
          h('span', { class: 'relation-name', text: item.title || item.id }),
        ),
        h('span', { class: 'small muted', text: item.reason || '标题或摘要关键词匹配，尚未确认学术关联' }),
      ),
      already ? h('span', { class: 'badge ok', text: '已引用' }) : h('button', {
        type: 'button', class: 'btn small', text: '加入来源',
        onclick: async () => {
          const paper = paperById.get(item.id);
          const next = [...(concept.sources || []), { paper_id: item.id, page: null, page_label: '', locator: '', verified_page: false }];
          try {
            await api.patch('concepts', concept.id, { revision: concept.revision, sources: next });
            toast(`已将《${paper ? paper.title : item.id}》加入来源（待核实页码）`);
            await ctx.refresh({ keepScroll: true });
          } catch (error) {
            toast(error.status === 409 ? `${error.message} 请重新读取后合并编辑。` : (error.message || '保存失败'), 'error');
          }
        },
      }),
    );
  })));
  return box;
}

/* ------------------------------------------------------------------ *
 * 显式关系编辑
 * ------------------------------------------------------------------ */

function editRelations(ctx, concept) {
  const others = (ctx.store.concepts || []).filter((item) => item.id !== concept.id);
  const options = others.map((item) => ({ value: item.id, label: `${item.name || item.id}（${item.id}）` }));
  openForm({
    title: `编辑显式关系 · ${concept.name || concept.id}`,
    description: '显式关系需引用已有概念 id；自动识别的「解释中提到」由服务计算，不在此保存。',
    wide: true,
    values: {
      prerequisite_ids: concept.prerequisite_ids || [],
      related_ids: concept.related_ids || [],
    },
    fields: [
      { name: 'prerequisite_ids', label: '前置概念', type: 'multiselect', options,
        help: others.length ? '按住 Ctrl / Cmd 多选。' : '库内暂无其他概念。' },
      { name: 'related_ids', label: '相关概念', type: 'multiselect', options },
    ],
    onSubmit: async (values) => {
      try {
        await api.patch('concepts', concept.id, {
          revision: concept.revision,
          prerequisite_ids: values.prerequisite_ids,
          related_ids: values.related_ids,
        });
        toast('已保存显式关系');
        await ctx.refresh({ keepScroll: true });
      } catch (error) {
        if (error.status === 409) throw new Error(`${error.message} 建议重新读取后再编辑。`);
        throw error;
      }
    },
  });
}

async function removeConcept(ctx, concept) {
  const ok = await openConfirm({
    title: '删除概念',
    message: `确认删除「${concept.name || concept.id}」？被其他记录显式关联时服务会拒绝。`,
    confirmLabel: '删除', danger: true,
  });
  if (!ok) return;
  try {
    await api.remove('concepts', concept.id, concept.revision);
    if (ctx.selection.concepts === concept.id) ctx.selection.concepts = '';
    toast('已删除概念');
    await ctx.refresh({ keepScroll: true });
  } catch (error) {
    toast(error.status === 409 ? `${error.message}` : (error.message || '删除失败'), 'error');
    await ctx.refresh({ keepScroll: true });
  }
}

/* ------------------------------------------------------------------ *
 * 编辑对话框
 * ------------------------------------------------------------------ */

export function openEditor(ctx, id) {
  const existing = id ? ctx.store.concepts.find((concept) => concept.id === id) : null;
  if (id && !existing) { toast('记录不存在，请重新读取', 'error'); return; }
  const base = existing || {
    id: '', name: '', aliases: [], domain: [], definition: '', explanation: '', sources: [],
    related_ids: [], prerequisite_ids: [], tags: [], notes: '', revision: 0,
  };
  const sourcesRef = { value: base.sources || [] };
  let sourcesAreaRef = null;

  openForm({
    title: existing ? `编辑概念 · ${existing.name || existing.id}` : '新增概念',
    description: existing
      ? '保存需附带原 revision；冲突时请重新读取并合并。'
      : '新概念由聊天 AI 在解释时按需创建；网页不凭字符串匹配生成定义。',
    wide: true,
    values: {
      name: base.name,
      aliases: base.aliases || [],
      domain: (base.domain || []).join(' / '),
      definition: base.definition,
      explanation: base.explanation,
      related_ids: base.related_ids || [],
      prerequisite_ids: base.prerequisite_ids || [],
      tags: base.tags || [],
      notes: base.notes,
    },
    fields: [
      { name: 'name', label: '名称', type: 'text', required: true },
      { name: 'aliases', label: '别名', type: 'list', help: '每行一个，或用逗号分隔。' },
      { name: 'domain', label: '分类路径（从上级到下级）', type: 'textarea', rows: 2, help: '如：物理 / 超导 / 电动力学，也可以每行一级；清空为未分类。' },
      { name: 'definition', label: '定义', type: 'textarea', rows: 3 },
      {
        name: 'explanation', label: '解释', type: 'textarea', rows: 7,
        help: '支持 LaTeX：行内公式用 $...$ 或 \\( ... \\)，独立公式用 $$...$$ 或 \\[ ... \\]。保存后自动排版。',
      },
      { group: '显式关系', name: 'prerequisite_ids', label: '前置概念 id', type: 'list', help: '每行一个已存在概念 id。' },
      { name: 'related_ids', label: '相关概念 id', type: 'list', help: '每行一个已存在概念 id。' },
      { name: 'tags', label: '标签', type: 'list' },
      { name: 'notes', label: '备注', type: 'textarea', rows: 2 },
    ],
    renderBefore: () => {
      const box = h('div', { class: 'editor-extra' });
      const area = h('textarea', { class: 'mono json-area', rows: '5' });
      area.value = JSON.stringify(sourcesRef.value, null, 2);
      sourcesAreaRef = area;
      box.appendChild(h('p', { class: 'form-group', text: '来源' }));
      box.appendChild(h('div', { class: 'form-row' },
        h('label', { class: 'form-label' }, 'sources（来源 JSON）'),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn small', text: '结构化编辑来源', onclick: async () => {
            try {
              sourcesRef.value = JSON.parse(area.value);
              if (!Array.isArray(sourcesRef.value)) throw new Error('出处须为数组');
            } catch (error) { toast(`出处 JSON 无效：${error.message}`, 'error'); return; }
            const next = await openSourcesEditor({ sources: sourcesRef.value, papers: ctx.store.papers || [], title: '编辑来源' });
            if (next) { sourcesRef.value = next; area.value = JSON.stringify(next, null, 2); }
          } }),
        ),
        h('details', { class: 'advanced-fields' }, h('summary', { text: '高级：出处 JSON' }), area),
        h('p', { class: 'form-help', text: '来源对象数组；保存时整体替换。' }),
      ));
      return box;
    },
    onSubmit: async (values) => {
      let sources;
      try {
        sources = JSON.parse(sourcesAreaRef ? sourcesAreaRef.value : '[]');
      } catch (error) {
        throw new Error(`JSON 解析失败：${error.message}`);
      }
      if (!Array.isArray(sources)) throw new Error('sources 必须是数组');
      const payload = {
        name: values.name, aliases: values.aliases, domain: parseDomainPath(values.domain),
        definition: values.definition, explanation: values.explanation, sources,
        related_ids: values.related_ids, prerequisite_ids: values.prerequisite_ids,
        tags: values.tags, notes: values.notes,
      };
      if (!existing) {
        const slug = String(values.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        if (/^[a-z0-9][a-z0-9_-]*$/.test(slug)) payload.id = slug;
      }
      try {
        if (existing) {
          await api.patch('concepts', existing.id, { revision: existing.revision, ...payload });
          toast('已保存概念');
        } else {
          await api.create('concepts', payload);
          toast('已创建概念');
        }
        await ctx.refresh({ keepScroll: true });
      } catch (error) {
        if (error.status === 409) throw new Error(`${error.message} 建议关闭对话框并重新读取后再编辑。`);
        throw error;
      }
    },
  });
}
