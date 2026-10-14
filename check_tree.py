"""Focused classification acceptance; never modifies the project's records."""
import json
import tempfile
import threading
from urllib.request import urlopen

from core import Store
from server import Handler, ThreadingHTTPServer


def main():
    with tempfile.TemporaryDirectory(prefix='concept-tree-check-') as directory:
        store = Store(directory)
        first = store.create('concepts', {'id': 'junction', 'name': '测试结', 'domain': ['物理', '超导'], 'definition': '保留的解释', 'notes': '用户备注'})
        store.create('concepts', {'id': 'phase', 'name': '测试相位', 'domain': ['物理', '超导', '相位']})
        store.create('concepts', {'id': 'uncategorized', 'name': '未分类条目', 'domain': []})
        store.create('concepts', {'id': 'literal-category', 'name': '名称恰为未分类的分类', 'domain': ['未分类']})
        tree = store.concept_tree()
        assert tree['count'] == 4
        assert len(tree['children']) == 3  # synthetic uncategorized must not merge with a real category
        physics = next(node for node in tree['children'] if node['name'] == '物理')
        assert physics['count'] == 2 and len(physics['children']) == 1
        superconductivity = physics['children'][0]
        assert superconductivity['path'] == ['物理', '超导']
        assert superconductivity['concepts'][0]['id'] == 'junction'
        assert superconductivity['children'][0]['concepts'][0]['id'] == 'phase'
        moved = store.patch('concepts', first['id'], {'revision': first['revision'], 'domain': ['工程', '测量']})
        assert moved['definition'] == '保留的解释' and moved['notes'] == '用户备注'
        physics = next(node for node in store.concept_tree()['children'] if node['name'] == '物理')
        assert physics['count'] == 1
        service = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        service.store = store
        threading.Thread(target=service.serve_forever, daemon=True).start()
        try:
            with urlopen(f'http://127.0.0.1:{service.server_port}/api/concept-tree') as response:
                assert json.load(response) == store.concept_tree()
        finally:
            service.shutdown()
            service.server_close()
        print('PASS: merged ancestors, direct/descendant leaves, uncategorized, classification move preserving content, tree API')


if __name__ == '__main__':
    main()
