// Classification-only module. domain is the single source of truth.
import { h, openForm, api, toast } from './ui.js';

const STORAGE_KEY = 'research-concept-tree-collapsed-v1';
let collapsed = new Set();
try { collapsed = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { /* Default expanded. */ }
let previousSelection = '';

export function parseDomainPath(value) {
  return String(value || '').split(/\s*(?:\/|／|>|→|\n|,|，)\s*/u).map(level => level.trim()).filter(Boolean);
}

export function buildConceptTree(records) {
  const node = (name, path, kind = 'category') => ({ name, path, kind, count: 0, concepts: [], children: new Map() });
  const root = node('知识分类', [], 'root');
  for (const record of records) {
    const path = (record.domain || []).map(level => level.trim()).filter(Boolean);
    let current = root;
    current.count++;
    if (!path.length) {
      if (!root.children.has(null)) root.children.set(null, node('未分类', [], 'uncategorized'));
      current = root.children.get(null);
      current.count++;
    }
    path.forEach((name, index) => {
      if (!current.children.has(name)) current.children.set(name, node(name, path.slice(0, index + 1)));
      current = current.children.get(name);
      current.count++;
    });
    current.concepts.push(record);
  }
  return root;
}

function keyOf(node) { return JSON.stringify([node.kind, ...node.path]); }

function remember() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed])); } catch { /* UI preference only. */ }
}

export function renderConceptTree(ctx, records, selectedId, { searching = false, onSelect } = {}) {
  const tree = buildConceptTree(records);
  const panel = h('section', { class: 'panel classification-panel', 'aria-label': '知识分类树' });
  const column = h('div', { class: 'group-column classification-column' }, panel);
  const branchNodes = [];
  const selected = records.find(record => record.id === selectedId);
  const reveal = selectedId && selectedId !== previousSelection;
  previousSelection = selectedId;

  const leaf = record => h('li', { class: 'classification-leaf' },
    h('div', { class: `classification-leaf-row${record.id === selectedId ? ' selected' : ''}` },
      h('button', {
        class: `concept-item tree-concept${record.id === selectedId ? ' active' : ''}`,
        type: 'button', 'aria-current': record.id === selectedId ? 'true' : null,
        onclick: () => onSelect(record.id),
      },
        h('span', { class: 'tree-leaf-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'concept-item-main' },
          h('span', { class: 'concept-name', text: record.name }),
          record.aliases?.length ? h('span', { class: 'small muted', text: record.aliases.join('、') }) : null,
        ),
      ),
      h('button', {
        type: 'button', class: 'tree-move-button', 'aria-label': `修改分类：${record.name}`,
        title: '修改分类', onclick: () => openCategoryEditor(ctx, record.id), text: '改分类',
      }),
    ),
  );

  const branch = node => {
    const key = keyOf(node);
    if (reveal && selected && node.kind === 'category' && node.path.every((part, i) => selected.domain[i] === part)) collapsed.delete(key);
    const details = h('details', { class: 'classification-branch', open: searching || !collapsed.has(key) });
    details.dataset.path = JSON.stringify(node.path);
    const children = h('ul', { class: 'classification-children', role: 'list' });
    const sorted = [...node.children.values()].sort((a, b) => {
      if (a.kind === 'uncategorized' || b.kind === 'uncategorized') return a.kind === b.kind ? 0 : a.kind === 'uncategorized' ? 1 : -1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    for (const child of sorted) children.appendChild(h('li', { class: 'classification-category' }, branch(child)));
    for (const record of [...node.concepts].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))) children.appendChild(leaf(record));
    details.appendChild(h('summary', { class: 'classification-node', title: node.path.join(' / ') || node.name },
      h('span', { class: 'tree-chevron', 'aria-hidden': 'true', text: '›' }),
      h('span', { class: 'classification-name', text: node.name }),
      h('span', { class: 'badge tree-count', text: String(node.count), title: '包含的概念数' }),
    ));
    details.appendChild(children);
    details.addEventListener('toggle', () => {
      if (searching) return; // Search expansion must not alter ordinary branch preferences.
      if (details.open) collapsed.delete(key); else collapsed.add(key);
      remember();
    });
    branchNodes.push({ details, key });
    return details;
  };

  const setAll = open => {
    for (const { details, key } of branchNodes) {
      details.open = open;
      if (!searching) { if (open) collapsed.delete(key); else collapsed.add(key); }
    }
    if (!searching) remember();
  };
  panel.appendChild(h('div', { class: 'block-head tree-header' },
    h('h2', { text: '知识分类树' }),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => setAll(true) }, '全部展开'),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => setAll(false) }, '全部折叠'),
    ),
  ));
  panel.appendChild(h('p', { class: 'small muted', text: searching ? `匹配 ${records.length} 个概念，已展开匹配路径。` : '展开分类，点击末端概念查看解释与出处。' }));
  if (!records.length) panel.appendChild(h('p', { class: 'empty small', text: '当前搜索无匹配概念。' }));
  else panel.appendChild(h('div', { class: 'classification-tree' },
    h('div', { class: 'classification-root' }, h('span', { text: tree.name }), h('span', { class: 'badge', text: String(tree.count) })),
    h('ul', { class: 'classification-children classification-roots', role: 'list' },
      [...tree.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')).map(child => h('li', { class: 'classification-category' }, branch(child))),
    ),
  ));
  return column;
}

export function openCategoryEditor(ctx, id) {
  const record = ctx.store.concepts.find(concept => concept.id === id);
  if (!record) { toast('概念不存在，请重新读取', 'error'); return; }
  const paths = new Map();
  for (const concept of ctx.store.concepts) {
    const path = concept.domain || [];
    if (path.length) paths.set(JSON.stringify(path), path.join(' / '));
  }
  const form = openForm({
    title: `修改分类 · ${record.name}`,
    description: '分类从上级到下级排列。保存后概念会移动到相应分支；清空则移到「未分类」。',
    values: { domain_path: record.domain.join(' / '), existing_path: '' },
    fields: [
      { name: 'existing_path', label: '选择已有分类（可选）', type: 'select', options: [
        { value: '', label: '自行输入或选择下方已有路径' },
        ...[...paths].sort((a, b) => a[1].localeCompare(b[1], 'zh-Hans-CN')).map(([value, label]) => ({ value, label })),
      ] },
      { name: 'domain_path', label: '分类路径', type: 'textarea', rows: 3,
        help: '例如：物理 / 凝聚态物理 / 超导。也可以每行一级。' },
    ],
    onSubmit: async values => {
      try {
        await api.patch('concepts', record.id, { revision: record.revision, domain: parseDomainPath(values.domain_path) });
        toast('分类已修改');
        await ctx.refresh({ keepScroll: true });
      } catch (error) {
        if (error.status === 409) throw new Error(`${error.message} 请重新读取后再修改分类。`);
        throw error;
      }
    },
  });
  form.form.querySelector('[name="existing_path"]').addEventListener('change', event => {
    if (event.target.value) form.form.querySelector('[name="domain_path"]').value = JSON.parse(event.target.value).join(' / ');
  });
}
