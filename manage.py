"""Narrow AI editing interface; reads only selected records."""
import argparse
import json
import sys
from pathlib import Path

from core import COLLECTIONS, DEFAULT_DATA, Problem, Store
from literature import search


def read_json(filename):
    if filename == '-':
        return json.load(sys.stdin)
    return json.loads(Path(filename).read_text(encoding='utf-8-sig'))


def main():
    parser = argparse.ArgumentParser(description='AI 科研记录接口；patch 顶层替换，要求旧 revision')
    parser.add_argument('--data', type=Path, default=DEFAULT_DATA)
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
