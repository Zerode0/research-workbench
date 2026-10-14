"""Narrow AI editing interface; reads only selected records."""
import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

from core import COLLECTIONS, DEFAULT_DATA, ROOT, Problem, Store
from literature import search


class RemoteStore:
    """Use the authenticated HTTP API when a private remote URL is configured."""

    def __init__(self, base_url, password_file):
        parsed = urlsplit(base_url)
        if (parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
            raise Problem('远程地址必须是 HTTPS 站点根地址')
        self.base_url = base_url.rstrip('/')
        try:
            self.password = Path(password_file).read_text(encoding='utf-8-sig').strip()
        except OSError as error:
            raise Problem(f'无法读取远程访问密码文件：{error}')
        if not 20 <= len(self.password) <= 200:
            raise Problem('远程访问密码须为 20–200 个字符')

    def request(self, method, path, body=None, content_type='application/json'):
        headers = {'Authorization': f'Bearer {self.password}', 'Accept': 'application/json'}
        if content_type:
            headers['Content-Type'] = content_type
        payload = None if body is None else body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode('utf-8')
        request = Request(self.base_url + path, data=payload, headers=headers, method=method)
        try:
            with urlopen(request, timeout=45) as response:
                raw = response.read()
        except HTTPError as error:
            raw = error.read()
            try:
                message = json.loads(raw).get('error', f'远程服务返回 HTTP {error.code}')
            except (ValueError, AttributeError):
                message = f'远程服务返回 HTTP {error.code}'
            raise Problem(message, error.code)
        except URLError as error:
            raise Problem(f'无法连接远程工作台：{error.reason}', 502)
        try:
            return json.loads(raw)
        except (ValueError, UnicodeError):
            raise Problem('远程工作台返回了无效 JSON', 502)

    def list(self, collection):
        return self.request('GET', '/api/state')[collection]

    def get(self, collection, rid):
        return self.request('GET', f'/api/{collection}/{quote(rid, safe="")}')

    def create(self, collection, fields):
        return self.request('POST', f'/api/{collection}', fields)

    def patch(self, collection, rid, fields):
        return self.request('PATCH', f'/api/{collection}/{quote(rid, safe="")}', fields)

    def delete(self, collection, rid, revision):
        query = urlencode({'revision': revision})
        return self.request('DELETE', f'/api/{collection}/{quote(rid, safe="")}?{query}')

    def relations(self, rid):
        return self.request('GET', f'/api/relations/{quote(rid, safe="")}')

    def concept_tree(self):
        return self.request('GET', '/api/concept-tree')

    def attach(self, rid, content, revision):
        query = urlencode({'revision': revision})
        return self.request('POST', f'/api/papers/{quote(rid, safe="")}/pdf?{query}', content, 'application/pdf')

    def decompose(self, rid, revision):
        return self.request('POST', f'/api/ideas/{quote(rid, safe="")}/decompose', {'revision': revision})

    def import_data(self, data):
        return self.request('POST', '/api/import', data)

    def export(self):
        return self.request('GET', '/api/export')


def configured_server():
    configured = os.environ.get('RESEARCH_WORKBENCH_URL', '').strip()
    config_file = Path(__file__).resolve().parent / '.access' / 'remote-url.txt'
    if config_file.is_file():
        configured = config_file.read_text(encoding='utf-8-sig').strip()
    return configured


def read_json(filename):
    if filename == '-':
        return json.load(sys.stdin)
    return json.loads(Path(filename).read_text(encoding='utf-8-sig'))


def main():
    parser = argparse.ArgumentParser(description='AI 科研记录接口；patch 顶层替换，要求旧 revision')
    parser.add_argument('--data', type=Path, default=DEFAULT_DATA)
    parser.add_argument('--server', default=configured_server(), help='HTTPS 工作台地址；不填时读取 RESEARCH_WORKBENCH_URL 或 .access/remote-url.txt')
    parser.add_argument('--password-file', type=Path, default=ROOT / '.access' / 'password.txt')
    parser.add_argument('--local', action='store_true', help='忽略远程地址，明确操作本机 data 目录')
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ('list', 'get', 'put', 'patch', 'delete'):
        sub = commands.add_parser(command)
        sub.add_argument('collection', choices=COLLECTIONS)
        if command in ('get', 'patch', 'delete'):
            sub.add_argument('id')
        if command in ('put', 'patch'):
            sub.add_argument('--file', required=True, help='UTF-8 JSON 文件，或 - 读取 stdin')
        if command == 'delete':
            sub.add_argument('--revision', required=True, type=int)
        if command == 'list':
            sub.add_argument('--query', default='')
            sub.add_argument('--limit', type=int, default=30)
    sub = commands.add_parser('search')
    sub.add_argument('query')
    sub.add_argument('--provider', choices=('openalex', 'crossref'), default='openalex')
    sub.add_argument('--recent', action='store_true')
    sub = commands.add_parser('relations')
    sub.add_argument('id')
    commands.add_parser('tree', help='输出由概念 domain 路径派生的分类树')
    sub = commands.add_parser('attach')
    sub.add_argument('id')
    sub.add_argument('--file', required=True)
    sub.add_argument('--revision', required=True, type=int)
    sub = commands.add_parser('export')
    sub.add_argument('--file')
    sub = commands.add_parser('import')
    sub.add_argument('--file', required=True)
    sub = commands.add_parser('decompose')
    sub.add_argument('id')
    sub.add_argument('--revision', type=int, required=True)
    args = parser.parse_args()
    if args.command == 'search':
        store = None
    elif args.server and not args.local:
        store = RemoteStore(args.server, args.password_file)
    else:
        store = Store(args.data)
    if args.command == 'list':
        rows = store.list(args.collection)
        if args.query:
            rows = [r for r in rows if args.query.casefold() in json.dumps(r, ensure_ascii=False).casefold()]
        result = {'total': len(rows), 'records': [{k: r[k] for k in ('id', 'title', 'name', 'status', 'domain', 'aliases', 'revision', 'updated_at', 'assessment') if k in r} for r in rows[:max(0, args.limit)]]}
    elif args.command == 'get':
        result = store.get(args.collection, args.id)
    elif args.command == 'put':
        result = store.create(args.collection, read_json(args.file))
    elif args.command == 'patch':
        result = store.patch(args.collection, args.id, read_json(args.file))
    elif args.command == 'delete':
        result = store.delete(args.collection, args.id, args.revision)
    elif args.command == 'search':
        result = search(args.query, args.provider, args.recent)
    elif args.command == 'relations':
        result = store.relations(args.id)
    elif args.command == 'tree':
        result = store.concept_tree()
    elif args.command == 'attach':
        result = store.attach(args.id, Path(args.file).read_bytes(), args.revision)
    elif args.command == 'decompose':
        result = store.decompose(args.id, args.revision)
    elif args.command == 'import':
        result = store.import_data(read_json(args.file))
    else:
        result = store.export()
        if args.file:
            Path(args.file).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            result = {'exported': str(Path(args.file).resolve()), 'pdf_included': False}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        main()
    except (Problem, OSError, ValueError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
