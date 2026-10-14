// ui.js — 共享的 DOM 工具、HTTP 客户端、对话框与表单、展示组件。
// 无依赖原生 ES module。用户文本一律通过 textContent 输出，不使用 innerHTML。

/* ------------------------------------------------------------------ *
 * 基础 DOM 工具
 * ------------------------------------------------------------------ */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
  }
  append(node, children);
  return node;
}

export function svg(tag, props, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value);
    }
  }
  append(node, children);
  return node;
}

export function frag(...children) {
  const node = document.createDocumentFragment();
  append(node, children);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

const pendingMathNodes = new Set();

function typesetPendingMath() {
  const mathJax = window.MathJax;
  if (!mathJax?.typesetPromise) return;
  for (const node of pendingMathNodes) {
    pendingMathNodes.delete(node);
    if (node.isConnected) mathJax.typesetPromise([node]).catch(() => {});
  }
}

if (typeof window !== 'undefined') window.addEventListener('mathjax-ready', typesetPendingMath);

export function mathContent(value) {
  const node = h('div', { class: 'math-content' });
  node.textContent = String(value ?? '');
  const mathJax = window.MathJax;
  if (mathJax?.startup?.promise) {
    mathJax.startup.promise.then(() => {
      if (node.isConnected && window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise([node]).catch(() => {});
      }
    });
  } else {
    pendingMathNodes.add(node);
  }
  return node;
}

export function matches(value, query) {
  if (!query) return true;
  return String(value ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

export function slugify(value, fallback = 'item') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  // id 只允许小写字母、数字、短横线、下划线；中文标题回退为时间戳 id。
  if (/^[a-z0-9][a-z0-9_-]*$/.test(slug)) return slug;
  return `${fallback}-${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ *
 * HTTP 客户端
 * ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function request(method, path, body, options = {}) {
  const init = { method, cache: 'no-store', headers: {} };
  if (body !== undefined && body !== null) {
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      init.body = body;
      init.headers['Content-Type'] = options.contentType || 'application/octet-stream';
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    throw new ApiError('无法连接工作台，请确认主机与网站服务仍在运行。', 0);
  }
  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch (error) { data = null; }
  }
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/api/')) {
      throw new ApiError('请通过侧栏「重新登录」在新窗口登录，然后返回保存；当前编辑仍保留。', 401);
    }
    const message = (data && typeof data.error === 'string' && data.error) || `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status);
  }
  return data;
}

export const api = {
  access: () => request('GET', '/api/access'),
  logout: () => request('POST', '/auth/logout', {}),
  state: () => request('GET', '/api/state'),
  get: (collection, id) => request('GET', `/api/${collection}/${encodeURIComponent(id)}`),
  create: (collection, body) => request('POST', `/api/${collection}`, body),
  patch: (collection, id, body) => request('PATCH', `/api/${collection}/${encodeURIComponent(id)}`, body),
  remove: (collection, id, revision) =>
    request('DELETE', `/api/${collection}/${encodeURIComponent(id)}?revision=${encodeURIComponent(revision)}`),
  relations: (id) => request('GET', `/api/relations/${encodeURIComponent(id)}`),
  literature: (query, provider, recent) =>
    request('GET', `/api/literature?q=${encodeURIComponent(query)}&provider=${encodeURIComponent(provider)}&recent=${recent ? 1 : 0}`),
  exportAll: () => request('GET', '/api/export'),
  importData: (data) => request('POST', '/api/import', data),
  decompose: (id, revision) => request('POST', `/api/ideas/${encodeURIComponent(id)}/decompose`, { revision }),
  uploadPdf: (id, revision, file) =>
    request('POST', `/api/papers/${encodeURIComponent(id)}/pdf?revision=${encodeURIComponent(revision)}`, file, { contentType: 'application/pdf' }),
};

/* ------------------------------------------------------------------ *
 * 展示辅助
 * ------------------------------------------------------------------ */

export const STATUS_LABELS = { inbox: '待评估', active: '进行中', paused: '已暂停', done: '已完成' };
export const ASSESSMENT_LABELS = { draft: '评估草稿', reviewed: '已评估' };
export const STEP_STATUS_LABELS = { todo: '待办', doing: '进行中', done: '已完成' };
export const PAPER_KIND_LABELS = { paper: '论文', textbook: '教材' };
export const RELATION_LABELS = {
  prerequisite: '前置概念（显式）',
  related: '相关概念（显式）',
  mentioned: '解释中提到（自动）',
  referenced_by: '对方提到（自动）',
};
export const RELATION_HINT = {
  prerequisite: '手动指定的前置概念',
  related: '手动指定的相关概念',
  mentioned: '定义或解释中提到此名词或别名',
  referenced_by: '对方定义、解释或显式关联提到当前概念',
};

export function formatTime(value) {
  if (!value) return '—';
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  return text;
}

export function absoluteUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch (error) {
    return '';
  }
}

export function pdfHref(paper, page) {
  if (!paper || !paper.local_pdf) return '';
  const base = `/pdf/${encodeURIComponent(paper.id)}.pdf`;
  if (Number.isInteger(page) && page > 0) return `${base}#page=${page}`;
  return base;
}

// 只有已核实（verified_page）且物理页码为正整数时才附加 #page=N。
export function sourcePdfHref(paper, source) {
  if (!paper) return '';
  if (paper.local_pdf) {
    return pdfHref(paper, source && source.verified_page === true ? source.page : null);
  }
  const base = absoluteUrl(paper.pdf_url);
  if (!base) return '';
  if (source && source.verified_page === true && Number.isInteger(source.page) && source.page > 0) {
    return `${base.split('#')[0]}#page=${source.page}`;
  }
  return base;
}

export function sourcePageText(source) {
  if (!source) return '';
  const parts = [];
  if (source.page_label) parts.push(`印刷页 ${source.page_label}`);
  if (source.locator) parts.push(source.locator);
  if (Number.isInteger(source.page) && source.page > 0) {
    parts.push(`物理页 ${source.page}${source.verified_page ? '（已核实）' : '（未核实，不跳页）'}`);
  } else if (source.verified_page) {
    parts.push('已核实但缺页码');
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ *
 * Toast 提示
 * ------------------------------------------------------------------ */

function toastRoot() {
  let root = document.getElementById('toasts');
  if (!root) {
    root = h('div', { id: 'toasts', class: 'toasts' });
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message, kind = 'info') {
  const node = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  node.addEventListener('click', () => node.remove());
  toastRoot().appendChild(node);
  setTimeout(() => node.remove(), kind === 'error' ? 8000 : 4500);
}

/* ------------------------------------------------------------------ *
 * 对话框
 * ------------------------------------------------------------------ */

function buildDialog({ title, description, wide = false }) {
  const dialog = h('dialog', { class: `dialog${wide ? ' dialog-wide' : ''}` });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const body = h('div', { class: 'dialog-body' });
  const form = h(
    'form',
    { class: 'dialog-form', novalidate: true },
    h('header', { class: 'dialog-head' },
      h('h2', { class: 'dialog-title', text: title }),
    ),
    description ? h('p', { class: 'dialog-desc', text: description }) : null,
    error,
    body,
  );
  const closeBtn = h('button', { type: 'button', class: 'dialog-close', 'aria-label': '关闭', title: '关闭', text: '×' });
  form.querySelector('.dialog-head').appendChild(closeBtn);
  dialog.appendChild(form);
  document.body.appendChild(dialog);

  const close = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });

  return {
    dialog, form, body, error, close,
    showError(message) { error.textContent = message; error.hidden = false; },
    clearError() { error.hidden = true; error.textContent = ''; },
    foot(...nodes) { const foot = h('footer', { class: 'dialog-foot' }, nodes); form.appendChild(foot); return foot; },
  };
}

/* ------------------------------------------------------------------ *
 * 通用表单
 * ------------------------------------------------------------------ */

function defaultText(field, value) {
  if (field.type === 'json') {
    const source = value === undefined || value === null ? field.emptyValue : value;
    if (source === undefined || source === null) return '';
    try { return JSON.stringify(source, null, 2); } catch (error) { return ''; }
  }
  if (field.type === 'list') return Array.isArray(value) ? value.join('\n') : (value ?? '');
  if (field.type === 'checkbox') return '';
  return value === undefined || value === null ? '' : String(value);
}

function buildInput(field, value) {
  const id = `f-${field.name}-${Math.random().toString(36).slice(2, 7)}`;
  const common = { id, name: field.name, ...(field.attrs || {}) };
  let input;
  switch (field.type) {
    case 'textarea':
    case 'json': {
      input = h('textarea', { ...common, rows: field.rows || (field.type === 'json' ? 6 : 3), placeholder: field.placeholder || '' });
      if (field.type === 'json') input.classList.add('mono');
      input.value = defaultText(field, value);
      break;
    }
    case 'number': {
      input = h('input', { ...common, type: 'number', inputmode: 'decimal', placeholder: field.placeholder || '' });
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
      input.value = defaultText(field, value);
      break;
    }
    case 'date': {
      input = h('input', { ...common, type: 'date' });
      input.value = defaultText(field, value);
      break;
    }
    case 'checkbox': {
      input = h('input', { ...common, type: 'checkbox' });
      input.checked = Boolean(value === undefined ? field.default : value);
      break;
    }
    case 'select': {
      input = h('select', common);
      for (const option of field.options || []) {
        const node = h('option', { value: option.value }, option.label);
        if (String(option.value) === String(value ?? '')) node.selected = true;
        input.appendChild(node);
      }
      break;
    }
    case 'multiselect': {
      input = h('select', { ...common, multiple: true, size: Math.min(8, Math.max(3, (field.options || []).length)) });
      const selected = new Set((Array.isArray(value) ? value : []).map(String));
      for (const option of field.options || []) {
        const node = h('option', { value: option.value }, option.label);
        if (selected.has(String(option.value))) node.selected = true;
        input.appendChild(node);
      }
      break;
    }
    default: {
      input = h('input', { ...common, type: 'text', placeholder: field.placeholder || '' });
      input.value = defaultText(field, value);
      break;
    }
  }
  input.dataset.fieldName = field.name;
  return { input, id };
}

function readInput(field, input) {
  switch (field.type) {
    case 'checkbox':
      return input.checked;
    case 'number': {
      const raw = input.value.trim();
      if (raw === '') return field.required ? NaN : null;
      return Number(raw);
    }
    case 'json': {
      const raw = input.value.trim();
      if (!raw) return field.emptyValue === undefined ? null : field.emptyValue;
      return JSON.parse(raw);
    }
    case 'list':
      return input.value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
    case 'multiselect':
      return Array.from(input.selectedOptions).map((option) => option.value);
    default:
      return input.value;
  }
}

function validateField(field, value) {
  const emptyText = typeof value === 'string' && value.trim() === '';
  if (field.required && (value === null || value === undefined || emptyText || (Array.isArray(value) && !value.length)
    || (typeof value === 'number' && Number.isNaN(value)))) {
    return `${field.label}不能为空`;
  }
  if (field.type === 'number' && value !== null && value !== undefined && !Number.isNaN(value)) {
    if (field.min !== undefined && value < field.min) return `${field.label}不得小于 ${field.min}`;
    if (field.max !== undefined && value > field.max) return `${field.label}不得大于 ${field.max}`;
    if (field.integer && !Number.isInteger(value)) return `${field.label}必须是整数`;
  }
  if (typeof field.validate === 'function') return field.validate(value);
  return '';
}

export function openForm(options) {
  const {
    title, description, fields = [], values = {}, submitLabel = '保存', cancelLabel = '取消',
    onSubmit, wide = false, renderBefore,
  } = options;
  const parts = buildDialog({ title, description, wide });
  const controls = new Map();
  let lastGroup = null;

  const extraFields = typeof renderBefore === 'function' ? renderBefore(parts) : null;

  fields.forEach((field) => {
    if (field.hidden) {
      controls.set(field.name, { field, input: null });
      return;
    }
    if (field.group && field.group !== lastGroup) {
      parts.body.appendChild(h('p', { class: 'form-group', text: field.group }));
      lastGroup = field.group;
    }
    const value = Object.prototype.hasOwnProperty.call(values, field.name)
      ? values[field.name]
      : field.default;
    if (field.type === 'checkbox') {
      const { input, id } = buildInput(field, value);
      const row = h('div', { class: 'form-row form-inline' },
        input,
        h('label', { class: 'form-label', for: id, text: field.label }),
      );
      if (field.help) row.appendChild(h('p', { class: 'form-help', text: field.help }));
      parts.body.appendChild(row);
      controls.set(field.name, { field, input });
      return;
    }
    const { input, id } = buildInput(field, value);
    if (field.disabled) input.disabled = true;
    const wrap = h('div', { class: 'form-row' },
      h('label', { class: 'form-label', for: id },
        field.label,
        field.required ? h('span', { class: 'required', title: '必填', text: '*' }) : null,
      ),
      input,
      field.help ? h('p', { class: 'form-help', text: field.help }) : null,
    );
    parts.body.appendChild(wrap);
    controls.set(field.name, { field, input });
  });

  if (extraFields) parts.body.appendChild(extraFields);
  const submitBtn = h('button', { type: 'submit', class: 'btn primary', text: submitLabel });
  const cancelBtn = h('button', { type: 'button', class: 'btn ghost', text: cancelLabel });
  parts.foot(cancelBtn, submitBtn);
  cancelBtn.addEventListener('click', parts.close);

  parts.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    parts.clearError();
    const collected = {};
    try {
      for (const { field, input } of controls.values()) {
        if (!input) continue;
        collected[field.name] = readInput(field, input);
      }
    } catch (error) {
      parts.showError(error instanceof SyntaxError ? `JSON 解析失败：${error.message}` : String(error.message || error));
      return;
    }
    for (const { field } of controls.values()) {
      const message = validateField(field, collected[field.name]);
      if (message) { parts.showError(message); return; }
    }
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = '保存中…';
    try {
      const result = await onSubmit(collected, parts);
      if (result === false) return;
      parts.close();
    } catch (error) {
      parts.showError(error && error.message ? error.message : '保存失败');
    } finally {
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  parts.dialog.addEventListener('close', () => parts.dialog.remove());
  parts.dialog.showModal();
  const first = parts.body.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
  if (first) first.focus();
  return parts;
}

export function openConfirm(options) {
  const { title, message, confirmLabel = '确认', danger = false } = options;
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog dialog-narrow' });
    let decided = false;
    const close = (value) => { decided = true; resolve(value); if (dialog.open) dialog.close(); dialog.remove(); };
    const form = h('form', { class: 'dialog-form', novalidate: true },
      h('header', { class: 'dialog-head' }, h('h2', { class: 'dialog-title', text: title })),
      h('div', { class: 'dialog-body' }, h('p', { class: 'dialog-text', text: message })),
      h('footer', { class: 'dialog-foot' },
        h('button', { type: 'button', class: 'btn ghost', text: '取消', onclick: () => close(false) }),
        h('button', { type: 'submit', class: `btn ${danger ? 'danger' : 'primary'}`, text: confirmLabel }),
      ),
    );
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    form.addEventListener('submit', (event) => { event.preventDefault(); close(true); });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(false); });
    dialog.addEventListener('close', () => { if (!decided) resolve(false); dialog.remove(); });
    dialog.showModal();
  });
}

/* ------------------------------------------------------------------ *
 * 来源（出处）编辑器
 * ------------------------------------------------------------------ */

export function sourceSummary(paper, source) {
  const pieces = [];
  if (paper) pieces.push(paper.title || paper.id);
  else pieces.push(source.paper_id || '未指定文献');
  const page = sourcePageText(source);
  if (page) pieces.push(page);
  return pieces.join('　·　');
}

async function openSourceForm({ source, papers, title }) {
  return new Promise((resolve) => {
    const options = papers.map((paper) => ({ value: paper.id, label: `${paper.title || paper.id}（${paper.id}）` }));
    let resolved = false;
    openForm({
      title,
      wide: true,
      values: {
        paper_id: source.paper_id || '',
        page: Number.isInteger(source.page) ? source.page : '',
        page_label: source.page_label || '',
        locator: source.locator || '',
        verified_page: source.verified_page === true,
      },
      fields: [
        { name: 'paper_id', label: '来源文献', type: 'select', required: true, options,
          help: '只能引用文献库中已有的记录；先在文献库检索并保存。' },
        { name: 'page', label: 'PDF 物理页码', type: 'number', min: 1, integer: true,
          help: '从 PDF 第一页开始计数；不确定请留空。' },
        { name: 'page_label', label: '教材印刷页码', type: 'text', help: '印刷页码另存，不写入物理页码。' },
        { name: 'locator', label: '章节 / 位置说明', type: 'text', placeholder: '如：第 3 章 3.2 节' },
        { name: 'verified_page', label: '页码已人工核实', type: 'checkbox',
          help: '仅核实后跳页；未核实不附加 #page。' },
      ],
      submitLabel: '确定',
      onSubmit: async (values) => {
        if (values.verified_page && !(Number.isInteger(values.page) && values.page > 0)) {
          return Promise.reject(new Error('已核实页码必须是正整数'));
        }
        resolved = true;
        resolve({
          paper_id: values.paper_id,
          page: Number.isInteger(values.page) && values.page > 0 ? values.page : null,
          page_label: values.page_label || '',
          locator: values.locator || '',
          verified_page: values.verified_page === true,
        });
      },
    }).dialog.addEventListener('close', () => { if (!resolved) resolve(null); });
  });
}

// 返回新的 sources 数组，或 null（用户取消）。
export async function openSourcesEditor({ sources, papers, title = '编辑出处' }) {
  return new Promise((resolve) => {
    const list = sources.map((item) => ({ ...item }));
    let resolved = false;
    const parts = buildDialog({ title, wide: true,
      description: '出处指向文献库中的记录；页码只在人工核实后才用于跳页。' });
    const body = h('div', { class: 'source-list form-row' });
    parts.body.appendChild(body);
    const saveBtn = h('button', { type: 'button', class: 'btn primary', text: '保存' });
    const cancelBtn = h('button', { type: 'button', class: 'btn ghost', text: '取消' });
    const addBtn = h('button', { type: 'button', class: 'btn', text: '新增出处' });
    parts.foot(addBtn, cancelBtn, saveBtn);

    const finish = (value) => { resolved = true; parts.close(); resolve(value); };
    cancelBtn.addEventListener('click', () => finish(null));
    parts.dialog.addEventListener('close', () => { if (!resolved) resolve(null); });

    const redraw = () => {
      clear(body);
      if (!list.length) {
        body.appendChild(h('p', { class: 'empty small', text: '暂无出处。' }));
      }
      list.forEach((source, index) => {
        const paper = papers.find((item) => item.id === source.paper_id) || null;
        const missing = !paper;
        body.appendChild(h('div', { class: 'source-row' },
          h('div', { class: 'source-main' },
            h('p', { class: 'source-title' }, paper ? paper.title : `未知文献 ${source.paper_id || ''}`),
            missing ? h('span', { class: 'badge warn', text: '文献不存在' }) : null,
            h('p', { class: 'muted small', text: sourceSummary(paper, source) }),
          ),
          h('div', { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn small', text: '编辑', onclick: async () => {
              const updated = await openSourceForm({ source, papers, title: '编辑出处' });
              if (updated) { list[index] = updated; redraw(); }
            } }),
            h('button', { type: 'button', class: 'btn small danger-ghost', text: '删除', onclick: () => {
              list.splice(index, 1); redraw();
            } }),
          ),
        ));
      });
      addBtn.disabled = papers.length === 0;
    };
    addBtn.addEventListener('click', async () => {
      const created = await openSourceForm({ source: {}, papers, title: '新增出处' });
      if (created) { list.push(created); redraw(); }
    });
    saveBtn.addEventListener('click', () => {
      const missing = list.filter((source) => !papers.some((paper) => paper.id === source.paper_id));
      if (missing.length) { parts.showError('仍有出处指向不存在的文献，请修正或删除。'); return; }
      finish(list.map((item) => ({ ...item })));
    });
    redraw();
    if (!papers.length) parts.showError('文献库为空：请先在「文献库」新增或检索文献，再添加出处。');
    parts.dialog.showModal();
  });
}
