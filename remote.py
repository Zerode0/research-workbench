"""Prepare or run an authenticated HTTPS entrance, without a cloud account.

prepare only downloads the official tunnel client; start publishes an entrance.
"""
import argparse
import hashlib
import json
import os
import queue
import re
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.request import Request, urlopen

from access import load_password
from core import ROOT, now

PRIVATE = ROOT / '.access'
BINARY = PRIVATE / 'bin' / 'cloudflared.exe'
PASSWORD = PRIVATE / 'password.txt'
STATE = PRIVATE / 'remote.json'
RELEASE = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
URL_PATTERN = re.compile(r'https://[a-z0-9-]+\.trycloudflare\.com\b')


def prepare():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    load_password(PASSWORD)
    metadata_path = PRIVATE / 'client.json'
    if BINARY.exists() and metadata_path.exists():
        saved = json.loads(metadata_path.read_text(encoding='utf-8'))
        with BINARY.open('rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest() == saved.get('sha256'):
                return saved
    request = Request(RELEASE, headers={'User-Agent': 'LocalResearchWorkbench/1.0'})
    with urlopen(request, timeout=20) as response:
        release = json.load(response)
    asset = next(a for a in release['assets'] if a['name'] == 'cloudflared-windows-amd64.exe')
    digest = asset.get('digest') or ''
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise RuntimeError('官方发行资产没有可验证的 SHA-256，已停止下载')
    download = asset['browser_download_url']
    if not download.startswith('https://github.com/cloudflare/cloudflared/releases/download/'):
        raise RuntimeError('下载地址不是官方 Cloudflare 仓库')
    BINARY.parent.mkdir(parents=True, exist_ok=True)
    temporary = BINARY.with_suffix('.download')
    try:
        with urlopen(Request(download, headers={'User-Agent': 'LocalResearchWorkbench/1.0'}), timeout=45) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        with temporary.open('rb') as handle:
            actual = hashlib.file_digest(handle, 'sha256').hexdigest()
        if actual != digest[7:]:
            raise RuntimeError('隧道客户端 SHA-256 不匹配，已停止')
        os.replace(temporary, BINARY)
    finally:
        temporary.unlink(missing_ok=True)
    saved = {'version': release['tag_name'], 'sha256': actual, 'source': download}
    metadata_path.write_text(json.dumps(saved, indent=2) + '\n', encoding='utf-8')
    return saved


def hidden_flags():
    return subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0


def available_port(port):
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', port))


def start(port, open_browser):
    metadata = prepare()
    available_port(port)
    empty_config = PRIVATE / 'tunnel.yml'
    empty_config.write_text('{}\n', encoding='utf-8')
    events = queue.Queue(maxsize=100)
    logfile = PRIVATE / 'tunnel.log'
    tunnel = subprocess.Popen([str(BINARY), '--no-autoupdate', '--config', str(empty_config),
                               'tunnel', '--url', f'http://127.0.0.1:{port}', '--protocol', 'http2'],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, encoding='utf-8', errors='replace', creationflags=hidden_flags())
    server = None
    def read_events():
        with logfile.open('a', encoding='utf-8') as handle:
            for line in tunnel.stdout:
                handle.write(line)
                handle.flush()
                try:
                    events.put_nowait(line)
                except queue.Full:
                    pass
    threading.Thread(target=read_events, daemon=True).start()
    try:
        address, deadline = '', time.monotonic() + 45
        while time.monotonic() < deadline:
            if tunnel.poll() is not None:
                raise RuntimeError(f'HTTPS 入口启动失败，详见 {logfile}')
            try:
                line = events.get(timeout=1)
            except queue.Empty:
                continue
            if match := URL_PATTERN.search(line):
                address = match[0]
                break
        if not address:
            raise RuntimeError(f'未在 45 秒内取得 HTTPS 地址，详见 {logfile}')
        with (PRIVATE / 'server.log').open('a', encoding='utf-8') as output:
            server = subprocess.Popen([sys.executable, '-u', str(ROOT / 'server.py'), '--port', str(port),
                                       '--public-url', address, '--password-file', str(PASSWORD)],
                                      stdout=output, stderr=subprocess.STDOUT, creationflags=hidden_flags())
        ready = False
        for _ in range(30):
            if server.poll() is not None:
                raise RuntimeError('登录服务启动失败，请查看 .access/server.log')
            try:
                with urlopen(f'http://127.0.0.1:{port}/api/access', timeout=1) as response:
                    ready = json.load(response).get('login_required') is True
            except OSError:
                time.sleep(.1)
            if ready:
                break
        if not ready:
            raise RuntimeError('登录服务未就绪')
        STATE.write_text(json.dumps({'url': address, 'port': port, 'started_at': now(),
                                    'launcher_pid': os.getpid(), 'server_pid': server.pid,
                                    'tunnel_pid': tunnel.pid, 'version': metadata['version']}, indent=2) + '\n', encoding='utf-8')
        print(f'外网入口：{address}\n访问密码文件：{PASSWORD}\n保持此进程运行；按 Ctrl+C 关闭外网入口。', flush=True)
        if open_browser:
            webbrowser.open(address)
        while tunnel.poll() is None and server.poll() is None:
            time.sleep(1)
        raise RuntimeError('HTTPS 入口或登录服务已经停止')
    finally:
        for process in (server, tunnel):
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
        STATE.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description='科研工作台 HTTPS 外网入口（密码登录）')
    parser.add_argument('command', choices=('prepare', 'start'))
    parser.add_argument('--port', type=int, default=8766, help='内部登录服务端口，默认不影响本机 8765 服务')
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    if args.command == 'prepare':
        saved = prepare()
        print(f'已准备 Cloudflare 客户端 {saved["version"]}，SHA-256 已验证。\n密码文件：{PASSWORD}\n尚未开启外网入口。', flush=True)
    else:
        start(args.port, args.open)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f'启动失败：{error}', file=sys.stderr)
        sys.exit(1)
