"""Per-record persistence and research-workbench rules. No third-party runtime."""
from __future__ import annotations

import copy
import json
import os
import re
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
from urllib.parse import urlsplit
from taxonomy import concept_tree

ROOT = Path(__file__).resolve().parent
DEFAULT_DATA = ROOT / 'data'
COLLECTIONS = ('ideas', 'concepts', 'papers')
ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9_-]{0,79}$')
MAX_STEP_DAYS = 3
TZ = timezone(timedelta(hours=8))


class Problem(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(TZ).isoformat(timespec='microseconds')


def today():
    return datetime.now(TZ).date().isoformat()


def identifier(value):
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise Problem('id 只能使用小写字母、数字、短横线和下划线，长度 1–80')
    return value


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def safe_url(value):
    if value and (not isinstance(value, str) or urlsplit(value).scheme not in ('http', 'https') or not urlsplit(value).netloc):
        raise Problem('链接必须是 http(s) URL')


def workday_end(start, days):
    current = date.fromisoformat(start)
    remaining = days
    while remaining:
        if current.weekday() < 5:
            remaining -= 1
        if remaining:
            current += timedelta(days=1)
    return current.isoformat()


def defaults(collection):
    base = {'notes': ''}
    if collection == 'ideas':
        base.update(title='', summary='', status='inbox', urgency=50, importance=50, difficulty=50,
                    assessment='draft', rationale={'urgency': '', 'importance': '', 'difficulty': ''},
                    assessed_at='', deadline='', sources=[], tags=[], steps=[])
    elif collection == 'concepts':
        base.update(name='', aliases=[], domain=[], definition='', explanation='', sources=[],
                    related_ids=[], prerequisite_ids=[], tags=[])
    else:
        base.update(title='', kind='paper', authors=[], year=None, doi='', url='', pdf_url='',
                    abstract='', venue='', provenance={}, local_pdf='')
    return base


def validate(collection, row):
    identifier(row.get('id'))
    name = 'name' if collection == 'concepts' else 'title'
    if not isinstance(row.get(name), str) or not row[name].strip():
        raise Problem('名称不能为空')
    for key in ('notes', 'summary', 'definition', 'explanation', 'abstract', 'venue', 'doi'):
        if key in row and not isinstance(row[key], str):
            raise Problem(f'{key} 必须为文本')
    for key in ('tags', 'aliases', 'domain', 'related_ids', 'prerequisite_ids', 'authors'):
        if key in row and (not isinstance(row[key], list) or any(not isinstance(x, str) for x in row[key])):
            raise Problem(f'{key} 必须为文本数组')
    if collection in ('ideas', 'concepts'):
        if not isinstance(row['sources'], list):
            raise Problem('sources 必须为数组')
        for source in row['sources']:
            if not isinstance(source, dict):
                raise Problem('来源必须为对象')
            identifier(source.get('paper_id'))
            page = source.get('page')
            if page is not None and (type(page) is not int or page < 1):
                raise Problem('PDF 物理页码必须是正整数或 null')
            if type(source.get('verified_page', False)) is not bool:
                raise Problem('verified_page 必须为布尔值')
            if source.get('verified_page') and page is None:
                raise Problem('已核实页码不能留空')
    if collection == 'ideas':
        for key in ('urgency', 'importance', 'difficulty'):
            if type(row.get(key)) not in (int, float) or not 0 <= row[key] <= 100:
                raise Problem(f'{key} 必须在 0–100 范围内')
        if row['status'] not in ('inbox', 'active', 'paused', 'done'):
            raise Problem('未知 idea 状态')
        if row['assessment'] not in ('draft', 'reviewed'):
            raise Problem('未知评估状态')
        if not isinstance(row['rationale'], dict):
            raise Problem('rationale 必须为对象')
        for key in ('urgency', 'importance', 'difficulty'):
            if not isinstance(row['rationale'].get(key, ''), str):
                raise Problem('评分理由必须为文本')
            if row['assessment'] == 'reviewed' and not row['rationale'].get(key, '').strip():
                raise Problem('已评估 idea 必须提供三个评分理由')
        for key in ('deadline', 'assessed_at'):
            if row.get(key):
                try:
                    date.fromisoformat(row[key])
                except (ValueError, TypeError):
                    raise Problem(f'{key} 应使用 YYYY-MM-DD')
        if row['assessment'] == 'reviewed' and not row.get('assessed_at'):
            raise Problem('已评估 idea 必须有评估日期')
        if not isinstance(row['steps'], list):
            raise Problem('steps 必须为数组')
        steps = {}
        for step in row['steps']:
            if not isinstance(step, dict):
                raise Problem('步骤必须为对象')
            sid = identifier(step.get('id'))
            if sid in steps:
                raise Problem('步骤 id 重复')
            steps[sid] = step
            if not isinstance(step.get('title'), str) or not step['title'].strip():
                raise Problem('步骤标题不能为空')
            if type(step.get('days')) is not int or not 1 <= step['days'] <= MAX_STEP_DAYS:
                raise Problem('每步必须为 1–3 个工作日，请继续拆分较大的步骤')
            if step.get('status', 'todo') not in ('todo', 'doing', 'done'):
                raise Problem('未知步骤状态')
            if not isinstance(step.get('depends_on', []), list):
                raise Problem('depends_on 必须为数组')
            for key in ('deliverable', 'acceptance'):
                if key in step and not isinstance(step[key], str):
                    raise Problem(f'{key} 必须为文本')
        visited, active = set(), set()
        def visit(sid):
            if sid in active:
                raise Problem('步骤依赖不能成环')
            if sid in visited:
                return
            active.add(sid)
            for dep in steps[sid].get('depends_on', []):
                if not isinstance(dep, str) or dep not in steps:
                    raise Problem('步骤依赖引用了不存在的步骤')
                visit(dep)
            active.remove(sid)
            visited.add(sid)
        for sid in steps:
            visit(sid)
    if collection == 'concepts':
        for key in ('related_ids', 'prerequisite_ids'):
            for cid in row[key]:
                identifier(cid)
                if cid == row['id']:
                    raise Problem('概念不能显式关联自身')
    if collection == 'papers':
        if row['kind'] not in ('paper', 'textbook'):
            raise Problem('文献类型必须为 paper 或 textbook')
        if row['year'] is not None and (type(row['year']) is not int or not 1000 <= row['year'] <= 3000):
            raise Problem('year 必须为年份整数或 null')
        safe_url(row['url'])
        safe_url(row['pdf_url'])
        if not isinstance(row.get('local_pdf'), str) or (row['local_pdf'] and row['local_pdf'] != f'pdf/{row["id"]}.pdf'):
            raise Problem('local_pdf 由 PDF 附件接口维护')
        if not isinstance(row['provenance'], dict):
            raise Problem('provenance 必须为对象')


class Store:
    def __init__(self, root=DEFAULT_DATA):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for collection in COLLECTIONS:
            (self.root / collection).mkdir(exist_ok=True)

    def path(self, collection, rid):
        if collection not in COLLECTIONS:
            raise Problem('未知数据集合', 404)
        return self.root / collection / f'{identifier(rid)}.json'

    @contextmanager
    def locked(self):
        # Kernel lock also protects simultaneous CLI/browser writers; released on crash.
        with (self.root / '.write.lock').open('a+b') as handle:
            if handle.tell() == 0:
                handle.write(b'0')
                handle.flush()
            deadline = time.monotonic() + 8
            while True:
                try:
                    handle.seek(0)
                    if os.name == 'nt':
                        import msvcrt
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise Problem('数据正在被修改，请稍后再试', 409)
                    time.sleep(.05)
            try:
                yield
            finally:
                if os.name == 'nt':
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle, fcntl.LOCK_UN)

    def get(self, collection, rid):
        path = self.path(collection, rid)
        if not path.exists():
            raise Problem('记录不存在', 404)
        return json.loads(path.read_text(encoding='utf-8'))

    def list(self, collection):
        self.path(collection, 'check')
        rows = [json.loads(p.read_text(encoding='utf-8')) for p in (self.root / collection).glob('*.json')]
        return sorted(rows, key=lambda r: r.get('updated_at', ''), reverse=True)

    def state(self):
        return {**{c: self.list(c) for c in COLLECTIONS}, 'today': today(), 'max_step_days': MAX_STEP_DAYS}

    def references(self, collection, row, available=None):
        def exists(coll, rid):
            return (coll, rid) in available if available is not None else self.path(coll, rid).exists()
        for source in row.get('sources', []):
            if not exists('papers', source['paper_id']):
                raise Problem(f'来源文献不存在：{source["paper_id"]}')
        if collection == 'concepts':
            for rid in row['related_ids'] + row['prerequisite_ids']:
                if not exists('concepts', rid):
                    raise Problem(f'关联概念不存在：{rid}')

    def atomic(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with temp.open('wb') as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)

    def backup(self, collection, row):
        path = self.root / '.history' / collection / row['id'] / f'{row["revision"]}.json'
        self.atomic(path, json_bytes(row))

    def create(self, collection, fields):
        with self.locked():
            row = {**defaults(collection), **copy.deepcopy(fields)}
            row['id'] = row.get('id') or uuid.uuid4().hex[:16]
            path = self.path(collection, row['id'])
            if path.exists():
                raise Problem('id 已存在', 409)
            if collection == 'papers' and row.get('local_pdf'):
                raise Problem('请通过附件接口上传本地 PDF')
            row.update(revision=1, created_at=now(), updated_at=now())
            validate(collection, row)
            self.references(collection, row)
            self.atomic(path, json_bytes(row))
            return row

    def patch(self, collection, rid, fields):
        with self.locked():
            old = self.get(collection, rid)
            if type(fields.get('revision')) is not int or fields['revision'] != old['revision']:
                raise Problem('版本冲突：请重新读取记录后合并编辑', 409)
            protected = ('id', 'created_at', 'updated_at', 'local_pdf')
            for key in protected:
                if key in fields and fields[key] != old.get(key):
                    raise Problem(f'{key} 不能通过普通编辑修改')
            row = {**old, **copy.deepcopy(fields), 'revision': old['revision'] + 1, 'updated_at': now()}
            validate(collection, row)
            self.references(collection, row)
            self.backup(collection, old)
            self.atomic(self.path(collection, rid), json_bytes(row))
            return row

    def delete(self, collection, rid, revision):
        with self.locked():
            old = self.get(collection, rid)
            if revision != old['revision']:
                raise Problem('版本冲突：请重新读取记录', 409)
            for coll in COLLECTIONS:
                for row in self.list(coll):
                    if (coll, row['id']) == (collection, rid):
                        continue
                    if collection == 'papers' and any(s['paper_id'] == rid for s in row.get('sources', [])):
                        raise Problem('文献仍被引用，请先修改来源引用', 409)
                    if collection == 'concepts' and rid in row.get('related_ids', []) + row.get('prerequisite_ids', []):
                        raise Problem('概念仍被显式关联，请先修改关联', 409)
            self.backup(collection, old)
            self.path(collection, rid).unlink()
            return {'deleted': True}

    def attach(self, rid, content, revision):
        if not content.startswith(b'%PDF-'):
            raise Problem('附件不是 PDF 文件')
        if len(content) > 64 * 1024 * 1024:
            raise Problem('PDF 超过 64 MB', 413)
        with self.locked():
            old = self.get('papers', rid)
            if revision != old['revision']:
                raise Problem('版本冲突：请重新读取文献', 409)
            target = self.root / 'pdf' / f'{rid}.pdf'
            if target.exists():
                self.atomic(self.root / '.history' / 'pdf' / rid / f'{old["revision"]}.pdf', target.read_bytes())
            self.atomic(target, content)
            row = {**old, 'local_pdf': f'pdf/{rid}.pdf', 'revision': old['revision'] + 1, 'updated_at': now()}
            self.backup('papers', old)
            self.atomic(self.path('papers', rid), json_bytes(row))
            return row

    def export(self):
        return {'schema_version': 1, **{c: self.list(c) for c in COLLECTIONS}}

    def import_data(self, data):
        if not isinstance(data, dict) or data.get('schema_version') != 1:
            raise Problem('不支持的数据版本')
        with self.locked():
            staged, available = [], {(c, r['id']) for c in COLLECTIONS for r in self.list(c)}
            for collection in COLLECTIONS:
                rows = data.get(collection, [])
                if not isinstance(rows, list):
                    raise Problem('导入集合必须为数组')
                for fields in rows:
                    if not isinstance(fields, dict):
                        raise Problem('导入记录必须为对象')
                    row = {**defaults(collection), **fields}
                    validate(collection, row)
                    key = (collection, row['id'])
                    if key in available:
                        raise Problem(f'导入存在重复 id：{collection}/{row["id"]}', 409)
                    if row.get('local_pdf') and not (self.root / row['local_pdf']).exists():
                        raise Problem('JSON 不包含 PDF 文件；请清空 local_pdf 后导入，再上传 PDF')
                    row.update(revision=1, created_at=now(), updated_at=now())
                    available.add(key)
                    staged.append((collection, row))
            for collection, row in staged:
                self.references(collection, row, available)
            # Stage all files, then commit while retaining rollback on a disk error.
            written = []
            try:
                for collection, row in staged:
                    path = self.path(collection, row['id'])
                    self.atomic(path, json_bytes(row))
                    written.append(path)
            except Exception:
                for path in written:
                    path.unlink(missing_ok=True)
                raise
            return {'imported': len(staged)}

    def relations(self, rid):
        current = self.get('concepts', rid)
        text = (current['definition'] + '\n' + current['explanation']).casefold()
        names = [current['name'], *current['aliases']]
        concepts = []
        for other in self.list('concepts'):
            if other['id'] == rid:
                continue
            cid = other['id']
            if cid in current['prerequisite_ids']:
                kind, reason = 'prerequisite', '手动指定的前置概念'
            elif cid in current['related_ids']:
                kind, reason = 'related', '手动指定的相关概念'
            elif any(mentions(text, term) for term in [other['name'], *other['aliases']]):
                kind, reason = 'mentioned', '定义或解释中提到此名词／别名'
            elif any(mentions((other['definition'] + '\n' + other['explanation']).casefold(), term) for term in names):
                kind, reason = 'referenced_by', '对方定义或解释提到当前名词'
            elif rid in other['related_ids'] or rid in other['prerequisite_ids']:
                kind, reason = 'referenced_by', '对方手动关联了当前概念'
            else:
                continue
            concepts.append({'id': cid, 'name': other['name'], 'type': kind, 'reason': reason})
        sources = {s['paper_id'] for s in current['sources']}
        papers = []
        for paper in self.list('papers'):
            pid = paper['id']
            if pid in sources:
                kind, reason = 'source', '已指定为该概念的出处'
            elif any(mentions((paper['title'] + ' ' + paper['abstract']).casefold(), n) for n in names):
                kind, reason = 'candidate', '标题或摘要关键词匹配，尚未确认学术关联'
            else:
                continue
            papers.append({'id': pid, 'title': paper['title'], 'type': kind, 'reason': reason})
        return {'concepts': concepts, 'papers': papers}

    def concept_tree(self):
        return concept_tree(self.list('concepts'))

    def decompose(self, rid, revision):
        row = self.get('ideas', rid)
        if row['steps']:
            raise Problem('已有步骤，请直接编辑，模板不能覆盖现有拆解', 409)
        steps = [
            {'id': 'literature', 'title': '文献梳理（草稿）', 'days': 2, 'status': 'todo', 'deliverable': '相关文献与问题边界清单', 'acceptance': '逐条记录支持证据和待核实项', 'depends_on': []},
            {'id': 'validation', 'title': '最小验证（草稿）', 'days': 3, 'status': 'todo', 'deliverable': '最小实验或分析记录', 'acceptance': '根据实际研究补充可测量指标', 'depends_on': ['literature']},
            {'id': 'summary', 'title': '整理结论（草稿）', 'days': 1, 'status': 'todo', 'deliverable': '结论及后续决策', 'acceptance': '区分已验证结果和假设', 'depends_on': ['validation']},
        ]
        return self.patch('ideas', rid, {'revision': revision, 'steps': steps})


def mentions(text, term):
    term = term.strip().casefold()
    if not term:
        return False
    if re.fullmatch(r'[a-z0-9 _-]+', term):
        return re.search(r'(?<![a-z0-9])' + re.escape(term) + r'(?![a-z0-9])', text) is not None
    return term in text
