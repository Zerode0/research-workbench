"""Focused acceptance checks; all records are confined to temporary directories."""
import json
import tempfile
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from core import Problem, Store, workday_end
from server import Handler, ThreadingHTTPServer


def rejected(action, status=400):
    try:
        action()
    except Problem as error:
        assert error.status == status, str(error)
    else:
        raise AssertionError('应拒绝此操作')


def main():
    with tempfile.TemporaryDirectory(prefix='research-workbench-check-') as directory:
        store = Store(directory)
        p = store.create('papers', {'id': 'paper-test', 'title': 'Inductance and flux', 'abstract': 'Inductance is relevant.'})
        c1 = store.create('concepts', {'id': 'inductance', 'name': '电感', 'aliases': ['inductance'], 'definition': '测试记录'})
        c2 = store.create('concepts', {'id': 'flux', 'name': '磁通', 'definition': '与电感有关', 'sources': [{'paper_id': p['id'], 'page': 2, 'verified_page': True}]})
        links = store.relations(c2['id'])
        assert links['concepts'][0]['id'] == c1['id']
        assert links['papers'][0]['type'] == 'source'
        assert store.relations(c1['id'])['papers'][0]['type'] == 'candidate'
        rejected(lambda: store.delete('papers', p['id'], p['revision']), 409)
        rejected(lambda: store.create('concepts', {'name': '悬空来源', 'sources': [{'paper_id': 'missing'}]}))
        idea = store.create('ideas', {'id': 'idea-test', 'title': '测试 idea'})
        idea = store.patch('ideas', idea['id'], {'revision': 1, 'notes': '用户备注'})
        rejected(lambda: store.patch('ideas', idea['id'], {'revision': 1, 'notes': '旧版本覆盖'}), 409)
        assert store.get('ideas', idea['id'])['notes'] == '用户备注'
        assert (Path(directory) / '.history/ideas/idea-test/1.json').exists()
        rejected(lambda: store.patch('ideas', idea['id'], {'revision': 2, 'assessment': 'reviewed'}))
        rejected(lambda: store.patch('ideas', idea['id'], {'revision': 2, 'steps': [{'id': 'a', 'title': '过大', 'days': 4}]}))
        rejected(lambda: store.patch('ideas', idea['id'], {'revision': 2, 'steps': [{'id': 'a', 'title': '环', 'days': 1, 'depends_on': ['a']}]}))
        idea = store.decompose(idea['id'], 2)
        assert all(1 <= s['days'] <= 3 for s in idea['steps'])
        rejected(lambda: store.decompose(idea['id'], 3), 409)
        assert workday_end('2026-10-09', 3) == '2026-10-13'
        pdf = b'%PDF-1.4\n%%EOF\n'
        p = store.attach(p['id'], pdf, 1)
        assert p['local_pdf'] == 'pdf/paper-test.pdf'
        exported = store.export()
        with tempfile.TemporaryDirectory(prefix='research-import-check-') as dest:
            target = Store(dest)
            rejected(lambda: target.import_data(exported))
            assert not target.list('ideas')
            exported['papers'][0]['local_pdf'] = ''
            assert target.import_data(exported)['imported'] == 4
            rejected(lambda: target.import_data(exported), 409)
        service = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        service.store = store
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{service.server_port}'
        try:
            with urlopen(base + '/api/state') as response:
                assert len(json.load(response)['ideas']) == 1
            with urlopen(base + '/pdf/paper-test.pdf') as response:
                assert response.read() == pdf
            request = Request(base + '/api/ideas/idea-test', data=b'{"revision":1,"notes":"bad"}', method='PATCH', headers={'Content-Type': 'application/json'})
            try:
                urlopen(request)
            except HTTPError as error:
                assert error.code == 409
            else:
                raise AssertionError('HTTP 应返回版本冲突')
            request = Request(base + '/api/ideas', data=b'{}', method='POST', headers={'Origin': 'https://foreign.example'})
            try:
                urlopen(request)
            except HTTPError as error:
                assert error.code == 403
            else:
                raise AssertionError('HTTP 应拒绝跨站写入')
        finally:
            service.shutdown()
            service.server_close()
        print('PASS: persistence, revisions, evidence references, graph links, step constraints, import, PDF, HTTP')


if __name__ == '__main__':
    main()
