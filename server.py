"""Run locally: python research-tools/server.py [--data PATH] [--port 8765]."""
from __future__ import annotations

import argparse
import json
import mimetypes
import socket
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from core import COLLECTIONS, DEFAULT_DATA, ROOT, Problem, Store, json_bytes
from literature import search
from access import Access, load_password


class Handler(BaseHTTPRequestHandler):
    server_version = 'ResearchWorkbench/1.0'

    def log_message(self, fmt, *args):
        # Do not log literature query strings or imported content.
        if args and isinstance(args[0], str):
            print(f'{self.command} {urlsplit(self.path).path}')

    def respond(self, value, status=200, cookie=None):
        content = json_bytes(value)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(content)

    def body(self, binary=False):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise Problem('Content-Length 不合法')
        limit = 64 * 1024 * 1024 if binary else 8 * 1024 * 1024
        if length < 0 or length > limit:
            raise Problem('请求内容过大', 413)
        content = self.rfile.read(length)
        self.body_consumed = True
        if binary:
            return content
        try:
            data = json.loads(content)
        except (ValueError, UnicodeError):
            raise Problem('请求内容必须是 JSON')
        if not isinstance(data, dict):
            raise Problem('JSON 顶层必须为对象')
        return data

    def dispatch(self):
        parts = urlsplit(self.path)
        segments = [unquote(x) for x in parts.path.split('/') if x]
        query = parse_qs(parts.query)
        store = self.server.store
        host = self.headers.get('Host', '')
        allowed_hosts = getattr(self.server, 'allowed_hosts', {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'})
        if host.lower() not in allowed_hosts:
            raise Problem('此访问地址未配置，请使用工作台启动时显示的地址', 403)
        if self.command != 'GET':
            origin = self.headers.get('Origin')
            allowed = getattr(self.server, 'allowed_origins', {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'})
            if origin and origin not in allowed:
                raise Problem('仅接受工作台页面的同源请求', 403)
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise Problem('拒绝跨站写入', 403)
        access = getattr(self.server, 'access', None)
        if segments == ['api', 'access'] and self.command == 'GET':
            return self.respond({'login_required': access is not None})
        if segments == ['auth', 'login'] and self.command == 'POST':
            if access is None:
                return self.respond({'logged_in': True})
            cookie = access.login(self.body().get('password'), self.client_address[0])
            return self.respond({'logged_in': True}, cookie=cookie)
        if segments == ['auth', 'logout'] and self.command == 'POST':
            return self.respond({'logged_out': True}, cookie=access.logout() if access else None)
        if self.command == 'GET' and parts.path in ('/login', '/login.html', '/login.js', '/styles.css'):
            return self.file('/login.html' if parts.path == '/login' else parts.path)
        if access and not access.authorized(self.headers):
            if segments[:1] == ['api'] or self.command != 'GET':
                raise Problem('请先登录科研工作台', 401)
            self.send_response(302)
            self.send_header('Location', '/login')
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return
        if segments[:1] != ['api']:
            if self.command != 'GET':
                raise Problem('方法不支持', 405)
            return self.file(parts.path)
        if self.command == 'GET':
            if segments == ['api', 'state']:
                return self.respond(store.state())
            if segments == ['api', 'concept-tree']:
                return self.respond(store.concept_tree())
            if segments == ['api', 'export']:
                return self.respond(store.export())
            if segments == ['api', 'literature']:
                return self.respond(search(query.get('q', [''])[0], query.get('provider', ['openalex'])[0], query.get('recent', ['0'])[0] == '1'))
            if len(segments) == 3 and segments[1] == 'relations':
                return self.respond(store.relations(segments[2]))
            if len(segments) == 3 and segments[1] in COLLECTIONS:
                return self.respond(store.get(segments[1], segments[2]))
        elif self.command == 'POST':
            if segments == ['api', 'import']:
                return self.respond(store.import_data(self.body()))
            if len(segments) == 2 and segments[1] in COLLECTIONS:
                return self.respond(store.create(segments[1], self.body()), 201)
            if len(segments) == 4 and segments[1] == 'papers' and segments[3] == 'pdf':
                try:
                    revision = int(query.get('revision', [''])[0])
                except ValueError:
                    raise Problem('上传 PDF 需要 revision')
                return self.respond(store.attach(segments[2], self.body(binary=True), revision))
            if len(segments) == 4 and segments[1] == 'ideas' and segments[3] == 'decompose':
                return self.respond(store.decompose(segments[2], self.body().get('revision')))
        elif self.command == 'PATCH' and len(segments) == 3 and segments[1] in COLLECTIONS:
            return self.respond(store.patch(segments[1], segments[2], self.body()))
        elif self.command == 'DELETE' and len(segments) == 3 and segments[1] in COLLECTIONS:
            try:
                revision = int(query.get('revision', [''])[0])
            except ValueError:
                raise Problem('删除需要 revision')
            return self.respond(store.delete(segments[1], segments[2], revision))
        raise Problem('接口不存在', 404)

    def file(self, raw_path):
        decoded = unquote(raw_path)
        if decoded.startswith('/pdf/'):
            rid = Path(decoded).name
            if not rid.endswith('.pdf') or decoded != '/pdf/' + rid:
                raise Problem('PDF 路径无效', 404)
            paper = self.server.store.get('papers', rid[:-4])
            if not paper.get('local_pdf'):
                raise Problem('尚未上传 PDF', 404)
            path = self.server.store.root / paper['local_pdf']
            content_type = 'application/pdf'
        else:
            web_root = (ROOT / 'web').resolve()
            path = (web_root / (decoded.lstrip('/') or 'index.html')).resolve()
            if not path.is_relative_to(web_root) or not path.is_file():
                raise Problem('页面文件不存在', 404)
            content_type = mimetypes.guess_type(path)[0] or 'application/octet-stream'
            if path.suffix == '.js':
                content_type = 'text/javascript'
        if not path.is_file():
            raise Problem('文件不存在', 404)
        content = path.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', content_type + ('; charset=utf-8' if content_type.startswith('text/') else ''))
        self.send_header('Content-Length', str(len(content)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'self'; frame-src 'self' https: http:; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(content)

    def handle_request(self):
        self.body_consumed = False
        try:
            self.dispatch()
        except Problem as error:
            # Drain small rejected request bodies before closing the connection.
            # Windows can reset a socket with unread bytes, hiding the JSON error.
            if self.command in ('POST', 'PATCH') and not self.body_consumed:
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if 0 < size <= 8 * 1024 * 1024:
                        self.connection.settimeout(3)
                        self.rfile.read(size)
                except (OSError, ValueError):
                    pass
            self.respond({'error': str(error)}, error.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            print(f'请求错误：{type(error).__name__}')
            self.respond({'error': '服务无法处理请求，请检查本地服务终端'}, 500)

    do_GET = do_POST = do_PATCH = do_DELETE = handle_request


def main():
    parser = argparse.ArgumentParser(description='本地科研工作台，无依赖、无打包')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--data', type=Path, default=DEFAULT_DATA)
    parser.add_argument('--host', default='127.0.0.1', help='监听地址；默认仅本机，局域网可用 0.0.0.0')
    parser.add_argument('--public-url', default='', help='反向代理的完整 HTTPS 地址；启用登录保护')
    parser.add_argument('--allow-host', action='append', default=[], help='附加允许的 Host（含端口）')
    parser.add_argument('--password-file', type=Path, default=ROOT / '.access' / 'password.txt')
    parser.add_argument('--open', action='store_true', help='在默认浏览器打开')
    args = parser.parse_args()
    if args.public_url:
        public = urlsplit(args.public_url)
        if public.scheme != 'https' or not public.netloc or public.username or public.password or public.query or public.fragment or public.path not in ('', '/'):
            parser.error('--public-url 必须为完整 HTTPS 站点根地址')
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.store = Store(args.data)
    server.daemon_threads = True
    hosts = {f'127.0.0.1:{server.server_port}', f'localhost:{server.server_port}', *[h.lower() for h in args.allow_host]}
    if args.host == '0.0.0.0':
        try:
            addresses = socket.gethostbyname_ex(socket.gethostname())[2]
            hosts.update(f'{ip}:{server.server_port}' for ip in addresses)
        except OSError:
            pass
    elif args.host != '127.0.0.1':
        hosts.add(f'{args.host}:{server.server_port}')
    server.allowed_hosts = hosts
    server.allowed_origins = {f'http://{host}' for host in hosts}
    if args.public_url:
        server.allowed_hosts.add(public.netloc.lower())
        server.allowed_origins.add(args.public_url.rstrip('/'))
    if args.host not in ('127.0.0.1', 'localhost') or args.public_url:
        try:
            password = load_password(args.password_file)
        except Problem as error:
            parser.error(str(error))
        server.access = Access(password, secure=bool(args.public_url))
        print(f'远程登录已启用，访问密码文件：{args.password_file.resolve()}', flush=True)
    address = f'http://127.0.0.1:{server.server_port}'
    print(f'科研工作台：{address}\n数据目录：{server.store.root}', flush=True)
    if args.public_url:
        print(f'外网入口：{args.public_url.rstrip("/")}', flush=True)
    if args.open:
        threading.Timer(.3, lambda: webbrowser.open(address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
