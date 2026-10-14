"""Small shared-password login for remote workbench access."""
import hashlib
import hmac
import secrets
import threading
import time
from http.cookies import SimpleCookie
from pathlib import Path

from core import Problem

COOKIE = 'research_session'
SESSION_SECONDS = 12 * 60 * 60


def load_password(filename):
    path = Path(filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('x', encoding='utf-8') as handle:
            handle.write(secrets.token_urlsafe(24) + '\n')
    except FileExistsError:
        pass
    password = path.read_text(encoding='utf-8-sig').strip()
    if len(password) < 20 or len(password) > 200:
        raise Problem('访问密码须为 20–200 个字符，请修改密码文件')
    return password


class Access:
    def __init__(self, password, secure=False):
        self.password = password
        self.secure = secure
        self.key = hashlib.sha256(('research-workbench-session:' + password).encode()).digest()
        self.failures = {}
        self.lock = threading.Lock()

    def signature(self, value):
        return hmac.new(self.key, value.encode(), hashlib.sha256).hexdigest()

    def login(self, password, peer):
        now = time.time()
        with self.lock:
            failed = [stamp for stamp in self.failures.get(peer, []) if now - stamp < 600]
            # Expired entries do not grow indefinitely.
            self.failures = {ip: times for ip, times in self.failures.items() if times and now - times[-1] < 600}
            if len(failed) >= 10:
                raise Problem('尝试过于频繁，请十分钟后重试', 429)
            if not isinstance(password, str) or len(password) > 200 or not hmac.compare_digest(password.encode(), self.password.encode()):
                self.failures[peer] = [*failed, now]
                raise Problem('访问密码不正确', 401)
            self.failures.pop(peer, None)
        payload = f'{int(now) + SESSION_SECONDS}.{secrets.token_hex(16)}'
        value = payload + '.' + self.signature(payload)
        return self.cookie(value, SESSION_SECONDS)

    def cookie(self, value, max_age):
        suffix = '; Secure' if self.secure else ''
        return f'{COOKIE}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{suffix}'

    def logout(self):
        return self.cookie('', 0)

    def authorized(self, headers):
        auth = headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            value = auth[7:]
            return len(value) <= 200 and hmac.compare_digest(value.encode(), self.password.encode())
        try:
            cookies = SimpleCookie()
            cookies.load(headers.get('Cookie', ''))
            if COOKIE not in cookies:
                return False
            value = cookies[COOKIE].value
            expires, nonce, signature = value.split('.')
            payload = expires + '.' + nonce
            return (len(value) < 200 and len(nonce) == 32 and time.time() < int(expires)
                    and hmac.compare_digest(signature, self.signature(payload)))
        except (ValueError, TypeError):
            return False
