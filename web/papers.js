// papers.js — 文献库：本地记录、在线检索候选、PDF 上传/URL、已核实页码定位。
import {
  api, h, clear, toast, openConfirm, openForm, matches, formatTime, absoluteUrl, pdfHref,
  PAPER_KIND_LABELS,
} from './ui.js';

const KINDS = [
  { value: 'paper', label: '论文' },
  { value: 'textbook', label: '教材' },
];

/* ------------------------------------------------------------------ *
 * 视图入口
 * ------------------------------------------------------------------ */

export function render(ctx, root) {
  const { store } = ctx;
  const selection = ctx.selection || {};
  const papers = store.papers || [];

  const searchInput = h('input', { type: 'search', class: 'search-input', placeholder: '搜索标题、作者、摘要、DOI、期刊…' });
  const kindFilter = h('select', { class: 'filter-select' },
    h('option', { value: 'all' }, '全部类型'),
    h('option', { value: 'paper' }, '论文'),
    h('option', { value: 'textbook' }, '教材'),
  );
  const layout = h('div', { class: 'concept-layout' });

  const draw = () => {
    clear(layout);
    const query = searchInput.value;
    const kind = kindFilter.value;
    const filtered = papers.filter((paper) => {
      if (kind !== 'all' && paper.kind !== kind) return false;
      return matches([paper.title, (paper.authors || []).join(' '), paper.abstract, paper.doi, paper.venue, paper.year].join(' '), query);
    });
    layout.appendChild(buildList(ctx, filtered, selection));
    layout.appendChild(buildDetailColumn(ctx, filtered, selection));
  };
  searchInput.addEventListener('input', draw);
  kindFilter.addEventListener('change', draw);

  root.appendChild(h('section', { class: 'page-head' },
    h('div', {},
      h('h1', { text: '文献库' }),
      h('p', { class: 'page-sub muted', text: '在线检索只返回候选；保存后才入库。PDF 可上传本地文件或填写公开 URL，仅核实后的物理页码用于跳转。' }),
    ),
    h('div', { class: 'head-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.editors.paper('') }, '＋ 新增文献'),
      h('button', { type: 'button', class: 'btn', onclick: () => openSearch(ctx) }, '在线检索'),
    ),
  ));

  root.appendChild(h('section', { class: 'panel' },
    h('div', { class: 'search-bar' }, searchInput, kindFilter,
      h('span', { class: 'muted small', text: `库内共 ${papers.length} 条（论文 / 教材）` })),
  ));

  if (!papers.length) {
    root.appendChild(h('section', { class: 'panel empty-state' },
      h('h2', { text: '文献库为空' }),
      h('p', { class: 'muted', text: '可先在线检索，或手动新增；文献被 idea / 概念的来源引用后不能直接删除。' }),
      h('div', { class: 'head-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => openSearch(ctx) }, '在线检索'),
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.editors.paper('') }, '手动新增'),
      ),
    ));
    return;
  }
  root.appendChild(layout);
  draw();
}

/* ------------------------------------------------------------------ *
 * 列表与详情
 * ------------------------------------------------------------------ */

function buildList(ctx, papers, selection) {
  const container = h('div', { class: 'group-column' });
  const list = h('ul', { class: 'concept-list' });
  if (!papers.length) {
    container.appendChild(h('section', { class: 'panel' }, h('h2', { text: '文献' }),
      h('p', { class: 'empty small', text: '当前筛选无记录。' })));
    return container;
  }
  for (const paper of papers) {
    const authors = (paper.authors || []).filter(Boolean);
    list.appendChild(h('li', {},
      h('button', { type: 'button', class: `concept-item${selection.papers === paper.id ? ' active' : ''}`,
        onclick: () => selectPaper(ctx, paper.id) },
        h('span', { class: 'concept-item-main' },
          h('span', { class: 'concept-name', text: paper.title || '（无标题）' }),
          h('span', { class: 'small muted', text: [authors.slice(0, 3).join('、'), paper.year, paper.venue].filter(Boolean).join(' · ') || '无元数据' }),
        ),
        h('span', { class: 'row-badges' },
          h('span', { class: 'badge', text: PAPER_KIND_LABELS[paper.kind] || paper.kind || '论文' }),
          paper.local_pdf ? h('span', { class: 'badge ok', text: 'PDF' }) : null,
        ),
      ),
    ));
  }
  container.appendChild(h('section', { class: 'panel' },
    h('h2', { class: 'domain-head' }, h('span', { text: `文献（${papers.length}）` })),
    list,
  ));
  return container;
}

function selectPaper(ctx, id) {
  ctx.selection.papers = ctx.selection.papers === id ? '' : id;
  ctx.render();
}

function buildDetailColumn(ctx, papers, selection) {
  const column = h('div', { class: 'detail-column' });
  const selected = papers.find((paper) => paper.id === selection.papers) || null;
  if (!selected) {
    column.appendChild(h('section', { class: 'panel detail-panel' },
      h('h2', { text: '文献详情' }),
      h('p', { class: 'empty small', text: '选择左侧文献查看 DOI、元数据、摘要、来源与 PDF 定位。' }),
    ));
    return column;
  }
  column.appendChild(buildDetail(ctx, selected));
  return column;
}

function metaRow(label, value) {
  if (!value) return null;
  return h('div', { class: 'meta-row' }, h('dt', { text: label }), h('dd', { text: value }));
}

function buildDetail(ctx, paper) {
  const panel = h('section', { class: 'panel detail-panel' });
  const authors = (paper.authors || []).filter(Boolean);
  const url = absoluteUrl(paper.url);
  const remotePdf = absoluteUrl(paper.pdf_url);
  const provenance = paper.provenance || {};

  panel.appendChild(h('div', { class: 'detail-head' },
    h('div', {},
      h('h2', { text: paper.title || '（无标题）' }),
      h('div', { class: 'chip-row' },
        h('span', { class: 'chip', text: PAPER_KIND_LABELS[paper.kind] || paper.kind }),
        paper.year ? h('span', { class: 'chip', text: String(paper.year) }) : null,
        paper.venue ? h('span', { class: 'chip', text: paper.venue }) : null,
      ),
    ),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => ctx.editors.paper(paper.id) }, '编辑'),
      h('button', { type: 'button', class: 'btn small', onclick: () => uploadPdf(ctx, paper) }, '上传 PDF'),
      h('button', { type: 'button', class: 'btn small danger-ghost', onclick: () => removePaper(ctx, paper) }, '删除'),
    ),
  ));
  panel.appendChild(h('p', { class: 'muted small', text: `id ${paper.id} · 版本 ${paper.revision} · 更新 ${formatTime(paper.updated_at)}` }));

  panel.appendChild(h('dl', { class: 'meta-list' },
    metaRow('作者', authors.join('、')),
    metaRow('DOI', paper.doi),
    metaRow('期刊 / 出版方', paper.venue),
    metaRow('类型', PAPER_KIND_LABELS[paper.kind] || paper.kind),
  ));

  panel.appendChild(h('div', { class: 'block' },
    h('h3', { text: '链接' }),
    h('ul', { class: 'link-list' },
      url ? h('li', {}, h('a', { href: url, target: '_blank', rel: 'noopener' }, url)) : h('li', { class: 'muted small', text: '无论文链接。' }),
      remotePdf && !paper.local_pdf ? h('li', {}, h('a', { href: remotePdf, target: '_blank', rel: 'noopener' }, `公开 PDF：${remotePdf}`)) : null,
    ),
  ));

  if (paper.abstract) {
    panel.appendChild(h('div', { class: 'block' }, h('h3', { text: '摘要' }),
      h('p', { class: 'abstract-text', text: paper.abstract })));
  }

  panel.appendChild(buildPdfBlock(ctx, paper));

  panel.appendChild(h('div', { class: 'block' },
    h('h3', { text: '检索来源' }),
    Object.keys(provenance).length
      ? h('dl', { class: 'meta-list' },
        metaRow('provider', provenance.provider),
        metaRow('query', provenance.query),
        metaRow('检索时间', formatTime(provenance.retrieved_at)),
        metaRow('endpoint', provenance.endpoint),
      )
      : h('p', { class: 'muted small', text: '无在线检索来源记录（可能是手动新增）。' }),
  ));

  if (paper.notes) panel.appendChild(h('div', { class: 'block' }, h('h3', { text: '备注' }), h('p', { text: paper.notes })));
  return panel;
}

function buildPdfBlock(ctx, paper) {
  const box = h('div', { class: 'block' });
  box.appendChild(h('h3', { text: 'PDF 与页码' }));
  if (paper.local_pdf) {
    const href = pdfHref(paper);
    box.appendChild(h('p', { class: 'small', text: `本地 PDF：${paper.local_pdf}` }));
    box.appendChild(h('div', { class: 'row-actions' },
      h('a', { class: 'btn small', href, target: '_blank', rel: 'noopener' }, '打开本地 PDF'),
    ));
  } else if (absoluteUrl(paper.pdf_url)) {
    box.appendChild(h('p', { class: 'small', text: '未上传本地 PDF，将使用公开 PDF URL。' }));
    box.appendChild(h('div', { class: 'row-actions' },
      h('a', { class: 'btn small', href: absoluteUrl(paper.pdf_url), target: '_blank', rel: 'noopener' }, '打开公开 PDF'),
    ));
  } else {
    box.appendChild(h('p', { class: 'muted small', text: '尚无 PDF；可上传本地文件或填写公开 PDF URL。' }));
  }

  const pageInput = h('input', { type: 'number', min: '1', step: '1', placeholder: '物理页码（从 1 开始）' });
  const goBtn = h('button', { type: 'button', class: 'btn small', text: '打开定位' });
  goBtn.addEventListener('click', () => {
    const value = Number(pageInput.value);
    if (!Number.isInteger(value) || value < 1) { toast('物理页码必须是正整数', 'error'); return; }
    if (paper.local_pdf) {
      window.open(`${pdfHref(paper)}#page=${value}`, '_blank', 'noopener');
    } else if (absoluteUrl(paper.pdf_url)) {
      toast('远程 PDF 是否支持 #page 定位取决于目标站点', 'info');
      window.open(`${absoluteUrl(paper.pdf_url)}#page=${value}`, '_blank', 'noopener');
    } else {
      toast('尚无可用 PDF', 'error');
    }
  });
  box.appendChild(h('div', { class: 'pdf-locator' },
    h('p', { class: 'muted small', text: '已核实 PDF 物理页码用 #page=N 定位；教材印刷页码请另存 page_label，不写入物理页码。' }),
    h('div', { class: 'search-bar' }, pageInput, goBtn),
  ));
  return box;
}

/* ------------------------------------------------------------------ *
 * 在线检索
 * ------------------------------------------------------------------ */

function openSearch(ctx) {
  const dialog = h('dialog', { class: 'dialog dialog-wide' });
  const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  const queryInput = h('input', { type: 'search', placeholder: '检索词（1–500 字符）' });
  const providerSelect = h('select', {},
    h('option', { value: 'openalex' }, 'OpenAlex'),
    h('option', { value: 'crossref' }, 'Crossref'));
  const recentBox = h('input', { type: 'checkbox' });
  const searchBtn = h('button', { type: 'button', class: 'btn primary', text: '检索' });
  const results = h('div', { class: 'search-results' });

  const form = h('form', { class: 'dialog-form', novalidate: true },
    h('header', { class: 'dialog-head' }, h('h2', { class: 'dialog-title', text: '在线文献检索' })),
    h('p', { class: 'dialog-desc', text: 'OpenAlex 失败时仅回退一次 Crossref。结果只是候选，尚未入库，相关性需自行核实。' }),
    error,
    h('div', { class: 'dialog-body' },
      h('div', { class: 'form-row' }, h('label', { class: 'form-label', text: '检索词' }), queryInput),
      h('div', { class: 'grid-2' },
        h('div', { class: 'form-row' }, h('label', { class: 'form-label', text: '来源' }), providerSelect),
        h('div', { class: 'form-row form-inline' }, recentBox, h('label', { class: 'form-label', text: '按最新排序' })),
      ),
      results,
    ),
    h('footer', { class: 'dialog-foot' },
      h('button', { type: 'button', class: 'btn ghost', text: '关闭', onclick: () => { dialog.close(); dialog.remove(); } }),
      searchBtn,
    ),
  );
  dialog.appendChild(form);
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());

  const existingIds = new Set((ctx.store.papers || []).map((paper) => paper.id));

  const runSearch = async () => {
    error.hidden = true;
    const query = queryInput.value.trim();
    if (!query) { error.textContent = '请输入 1–500 字符的检索词'; error.hidden = false; return; }
    clear(results);
    results.appendChild(h('p', { class: 'loading small muted', text: '正在检索…' }));
    searchBtn.disabled = true;
    try {
      const data = await api.literature(query, providerSelect.value, recentBox.checked);
      clear(results);
      if (data.warnings && data.warnings.length) {
        for (const warning of data.warnings) {
          results.appendChild(h('p', { class: 'warn-text small', text: warning }));
        }
      }
      results.appendChild(h('p', { class: 'muted small',
        text: `来源 ${data.provider} · 检索时间 ${formatTime(data.retrieved_at)} · 结果 ${data.results.length} 条` }));
      if (!data.results.length) {
        results.appendChild(h('p', { class: 'empty small', text: '没有返回结果；可换关键词或来源重试。' }));
      }
      for (const paper of data.results) {
        results.appendChild(candidateRow(ctx, paper, existingIds));
      }
    } catch (err) {
      clear(results);
      results.appendChild(h('p', { class: 'error-text small', text: err.message || '检索失败' }));
    } finally {
      searchBtn.disabled = false;
    }
  };
  searchBtn.addEventListener('click', runSearch);
  form.addEventListener('submit', (event) => { event.preventDefault(); runSearch(); });
  dialog.showModal();
  queryInput.focus();
}

function candidateRow(ctx, paper, existingIds) {
  const authors = (paper.authors || []).filter(Boolean);
  const p = absoluteUrl(paper.pdf_url);
  const row = h('div', { class: 'candidate-card' },
    h('div', { class: 'candidate-main' },
      h('p', { class: 'candidate-title', text: paper.title || '（无标题）' }),
      h('p', { class: 'small muted', text: [authors.slice(0, 5).join('、'), paper.year, paper.venue].filter(Boolean).join(' · ') || '无元数据' }),
      paper.doi ? h('p', { class: 'small muted', text: `DOI ${paper.doi}` }) : null,
      p ? h('p', { class: 'small' }, h('a', { href: p, target: '_blank', rel: 'noopener' }, '公开 PDF')) : null,
      paper.abstract ? h('details', {}, h('summary', { class: 'small', text: '摘要' }), h('p', { class: 'abstract-text small', text: paper.abstract })) : null,
      h('span', { class: 'badge warn', text: '检索候选，相关性尚未核实' }),
    ),
  );
  const save = h('button', { type: 'button', class: 'btn small primary', text: existingIds.has(paper.id) ? '已入库' : '保存候选' });
  save.disabled = existingIds.has(paper.id);
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api.create('papers', paper);
      existingIds.add(paper.id);
      save.textContent = '已入库';
      toast(`已保存《${paper.title || paper.id}》，请核实相关性后再加入来源`);
      await ctx.refresh({ keepScroll: true });
    } catch (err) {
      save.disabled = false;
      toast(err.status === 409 ? `${err.message}` : (err.message || '保存失败'), 'error');
    }
  });
  row.appendChild(save);
  return row;
}

/* ------------------------------------------------------------------ *
 * PDF 上传
 * ------------------------------------------------------------------ */

function uploadPdf(ctx, paper) {
  const fileInput = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.remove();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { toast('请选择 PDF 文件', 'error'); return; }
    try {
      await api.uploadPdf(paper.id, paper.revision, file);
      toast('PDF 已上传');
      await ctx.refresh({ keepScroll: true });
    } catch (error) {
      toast(error.status === 409 ? `${error.message} 请重新读取后再上传。` : (error.message || '上传失败'), 'error');
      if (error.status === 409) await ctx.refresh({ keepScroll: true });
    }
  });
  fileInput.click();
}

async function removePaper(ctx, paper) {
  const ok = await openConfirm({
    title: '删除文献',
    message: `确认删除《${paper.title || paper.id}》？仍被来源引用时服务会拒绝。`,
    confirmLabel: '删除', danger: true,
  });
  if (!ok) return;
  try {
    await api.remove('papers', paper.id, paper.revision);
    if (ctx.selection.papers === paper.id) ctx.selection.papers = '';
    toast('已删除文献');
    await ctx.refresh({ keepScroll: true });
  } catch (error) {
    toast(error.message || '删除失败', 'error');
    await ctx.refresh({ keepScroll: true });
  }
}

/* ------------------------------------------------------------------ *
 * 编辑对话框
 * ------------------------------------------------------------------ */

export function openEditor(ctx, id) {
  const existing = id ? ctx.store.papers.find((paper) => paper.id === id) : null;
  if (id && !existing) { toast('记录不存在，请重新读取', 'error'); return; }
  const base = existing || {
    id: '', title: '', kind: 'paper', authors: [], year: null, doi: '', url: '', pdf_url: '',
    abstract: '', venue: '', provenance: {}, notes: '', local_pdf: '', revision: 0,
  };
  const provenanceRef = { value: base.provenance || {} };
  let provenanceAreaRef = null;

  openForm({
    title: existing ? `编辑文献 · ${existing.title || existing.id}` : '新增文献',
    description: existing
      ? '保存需附带原 revision；冲突时请重新读取并合并。local_pdf 由上传接口维护，不能在此修改。'
      : '手动新增的文献没有在线检索来源；URL 仅允许 http(s)。',
    wide: true,
    values: {
      title: base.title, kind: base.kind, authors: base.authors || [],
      year: base.year === null || base.year === undefined ? '' : base.year,
      doi: base.doi, url: base.url, pdf_url: base.pdf_url, venue: base.venue,
      abstract: base.abstract, notes: base.notes,
    },
    fields: [
      { name: 'title', label: '标题', type: 'text', required: true },
      { name: 'kind', label: '类型', type: 'select', options: KINDS },
      { name: 'authors', label: '作者', type: 'list', help: '每行一位，或用逗号分隔。' },
      { name: 'year', label: '年份', type: 'number', min: 1000, max: 3000, integer: true, help: '可留空。' },
      { name: 'venue', label: '期刊 / 出版方', type: 'text' },
      { name: 'doi', label: 'DOI', type: 'text' },
      { name: 'url', label: '论文 URL', type: 'text', placeholder: 'https://…', help: '仅 http(s)。' },
      { name: 'pdf_url', label: '公开 PDF URL', type: 'text', placeholder: 'https://…/paper.pdf', help: '仅 http(s)。' },
      { name: 'abstract', label: '摘要', type: 'textarea', rows: 5 },
      { name: 'notes', label: '备注', type: 'textarea', rows: 2 },
    ],
    renderBefore: () => {
      const box = h('div', { class: 'editor-extra' });
      const area = h('textarea', { class: 'mono json-area', rows: '5' });
      area.value = JSON.stringify(provenanceRef.value, null, 2);
      provenanceAreaRef = area;
      box.appendChild(h('p', { class: 'form-group', text: '检索来源' }));
      box.appendChild(h('div', { class: 'form-row' },
        h('label', { class: 'form-label' }, 'provenance（来源 JSON）'),
        h('details', { class: 'advanced-fields' }, h('summary', { text: '高级：检索来源 JSON' }), area),
        h('p', { class: 'form-help', text: '对象字段：provider / query / retrieved_at / endpoint。' }),
      ));
      return box;
    },
    onSubmit: async (values) => {
      let provenance;
      try {
        provenance = JSON.parse(provenanceAreaRef ? provenanceAreaRef.value : '{}');
      } catch (error) {
        throw new Error(`JSON 解析失败：${error.message}`);
      }
      if (!provenance || Array.isArray(provenance) || typeof provenance !== 'object') throw new Error('provenance 必须是对象');
      const url = values.url.trim();
      const pdfUrl = values.pdf_url.trim();
      const checkUrl = (value, label) => {
        if (!value) return;
        try {
          const parsed = new URL(value);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
        } catch (error) {
          throw new Error(`${label}必须是 http(s) URL`);
        }
      };
      checkUrl(url, '论文 URL');
      checkUrl(pdfUrl, 'PDF URL');
      const payload = {
        title: values.title, kind: values.kind, authors: values.authors,
        year: Number.isInteger(values.year) ? values.year : null,
        doi: values.doi.trim(), url, pdf_url: pdfUrl, venue: values.venue,
        abstract: values.abstract, provenance, notes: values.notes,
      };
      try {
        if (existing) {
          await api.patch('papers', existing.id, { revision: existing.revision, ...payload });
          toast('已保存文献');
        } else {
          await api.create('papers', payload);
          toast('已创建文献');
        }
        await ctx.refresh({ keepScroll: true });
      } catch (error) {
        if (error.status === 409) throw new Error(`${error.message} 建议关闭对话框并重新读取后再编辑。`);
        throw error;
      }
    },
  });
}

// 供其他模块选择文献（当前未被来源编辑器使用，保留为通用入口）。
export function openPicker(ctx, options = {}) {
  return new Promise((resolve) => {
    const papers = ctx.store.papers || [];
    const select = h('select', { size: '8' });
    for (const paper of papers) {
      select.appendChild(h('option', { value: paper.id }, `${paper.title || paper.id}（${paper.id}）`));
    }
    let resolved = false;
    openForm({
      title: options.title || '选择文献',
      wide: true,
      renderBefore: () => h('div', { class: 'form-row' },
        papers.length ? select : h('p', { class: 'empty small', text: '文献库为空。' })),
      fields: [],
      submitLabel: '确定',
      onSubmit: async () => {
        const id = select.value;
        if (!id) throw new Error('请选择一条文献');
        resolved = true;
        resolve(papers.find((paper) => paper.id === id) || null);
      },
    }).dialog.addEventListener('close', () => { if (!resolved) resolve(null); });
  });
}
