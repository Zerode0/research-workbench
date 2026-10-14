"""Authentication and remote-origin acceptance in a temporary data directory."""
import json
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from access import Access, COOKIE
from core import Problem, Store
from server import Handler, ThreadingHTTPServer


def main():
    with tempfile.TemporaryDirectory(prefix='research-access-check-') as folder:
        service = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        service.store = Store(folder)
        service.access = Access('acceptance-password-12345', secure=True)
        host = 'private-test.trycloudflare.com'
        service.allowed_hosts = {host, f'127.0.0.1:{service.server_port}'}
        service.allowed_origins = {f'https://{host}'}
        threading.Thread(target=service.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{service.server_port}'
        def request(path, method='GET', body=None, cookie=None, origin=None, code=200, alternate_host=None):
            headers = {'Host': alternate_host or host}
            if body is not None:
                headers['Content-Type'] = 'application/json'
            if cookie:
                headers['Cookie'] = cookie
            if origin:
                headers['Origin'] = origin
            data = None if body is None else json.dumps(body).encode()
            req = Request(base + path, data=data, headers=headers, method=method)
            try:
                response = urlopen(req, timeout=3)
            except HTTPError as error:
                response = error
            with response:
                assert response.code == code, (path, response.code, code)
                content = response.read()
                return content, response.headers
        try:
            request('/api/state', code=401)
            request('/api/export', code=401)
            request('/pdf/missing.pdf', code=200)  # redirected to login, never exposes files
            request('/api/state', alternate_host='foreign.example', code=403)
            content, _ = request('/login')
            assert b'login-form' in content
            request('/auth/login', 'POST', {'password': 'wrong'}, code=401)
            _, headers = request('/auth/login', 'POST', {'password': 'acceptance-password-12345'}, origin=f'https://{host}')
            cookie_header = headers['Set-Cookie']
            assert 'HttpOnly' in cookie_header and 'SameSite=Strict' in cookie_header and 'Secure' in cookie_header
            cookie = cookie_header.split(';')[0]
            assert service.access.authorized({'Cookie': cookie})
            assert not service.access.authorized({'Cookie': cookie + 'tampered'})
            content, _ = request('/api/ideas', 'POST', {'id': 'remote-idea', 'title': '远程测试'}, cookie=cookie, origin=f'https://{host}', code=201)
            row = json.loads(content)
            content, _ = request('/api/ideas/remote-idea', 'PATCH', {'revision': row['revision'], 'notes': '远程修改'}, cookie=cookie, origin=f'https://{host}')
            assert json.loads(content)['notes'] == '远程修改'
            request('/api/ideas/remote-idea', 'PATCH', {'revision': row['revision'], 'notes': '旧版本'}, cookie=cookie, origin=f'https://{host}', code=409)
            request('/api/ideas', 'POST', {}, cookie=cookie, origin='https://foreign.example', code=403)
            request('/api/state', cookie=cookie, code=200)
            content, _ = request('/auth/logout', 'POST', {}, cookie=cookie, origin=f'https://{host}')
            assert json.loads(content)['logged_out']
            expired = f'{int(time.time())-1}.0123456789abcdef0123456789abcdef'
            assert not service.access.authorized({'Cookie': f'{COOKIE}={expired}.{service.access.signature(expired)}'})
            for _ in range(10):
                try:
                    service.access.login('wrong', 'test-peer')
                except Problem as error:
                    assert error.status == 401
            try:
                service.access.login('wrong', 'test-peer')
            except Problem as error:
                assert error.status == 429
            else:
                raise AssertionError('Rate limit missing')
            print('PASS: login, private reads/PDF, remote edits, revisions, cookie expiry, Host/Origin checks, rate limit')
        finally:
            service.shutdown()
            service.server_close()


if __name__ == '__main__':
    main()
