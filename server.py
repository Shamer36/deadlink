# Deadlink: локальный сервер. Запуск: python server.py  (или двойной клик по ЗАПУСК.bat)
import http.server, json, os, re, uuid, threading, webbrowser, shutil, time, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, 'data', 'db.json')
BLOB = os.path.join(ROOT, '_blob')
BACKUP = os.path.join(ROOT, 'data', 'backups')
PORT = int(os.environ.get('PORT', '8000'))
LOCK = threading.Lock()
EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
       'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a'}
MIME = {v: k for k, v in EXT.items()}
MIME['.m4a'] = 'audio/mp4'

def load():
    with open(DB, encoding='utf-8') as f: return json.load(f)

def save(db):
    tmp = DB + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(db, f, ensure_ascii=False)
    os.replace(tmp, DB)

def backup_once_a_day():
    os.makedirs(BACKUP, exist_ok=True)
    name = os.path.join(BACKUP, 'db-' + time.strftime('%Y-%m-%d') + '.json')
    if os.path.exists(DB) and not os.path.exists(name): shutil.copy(DB, name)


# ---------- аккаунты ----------
import hashlib, hmac, secrets
ACC = os.path.join(ROOT, 'data', 'accounts.json')
ALOCK = threading.Lock()
LOGIN_RE = re.compile(r'[A-Za-z0-9_.\-]{3,20}')
SESSION_DAYS = 365
FAILS = {}  # login -> [кол-во ошибок, время блокировки]

def acc_load():
    try:
        with open(ACC, encoding='utf-8') as f: a = json.load(f)
    except Exception: a = {}
    a.setdefault('users', {}); a.setdefault('sessions', {}); return a

def acc_save(a):
    tmp = ACC + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(a, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ACC)

def pw_hash(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), bytes.fromhex(salt), 200000).hex()
    return salt, h

def find_user(a, login):
    lo = login.lower()
    for uid, u in a['users'].items():
        if u['login'].lower() == lo: return uid, u
    return None, None

def new_session(a, uid):
    t = secrets.token_urlsafe(32)
    a['sessions'][t] = {'uid': uid, 'exp': int(time.time()) + SESSION_DAYS * 86400}
    now = time.time()
    for k in [k for k, v in a['sessions'].items() if v.get('exp', 0) < now]: a['sessions'].pop(k, None)
    return t

INBOX = os.path.join(ROOT, 'data', 'inbox')
def import_inbox():
    import zipfile, glob
    os.makedirs(INBOX, exist_ok=True); os.makedirs(BLOB, exist_ok=True); n = 0
    for z in sorted(glob.glob(os.path.join(INBOX, '*.zip'))):
        try:
            with zipfile.ZipFile(z) as zf:
                for m in zf.namelist():
                    b = os.path.basename(m)
                    if re.fullmatch(r'[0-9a-f]{32}\.(jpg|png|webp|gif|mp4|webm|mp3|m4a)', b):
                        with zf.open(m) as src, open(os.path.join(BLOB, b), 'wb') as dst: shutil.copyfileobj(src, dst); n += 1
            os.remove(z)
        except Exception as e: print('inbox error', z, e, flush=True)
    if n: print('Добавлено файлов из inbox:', n, flush=True); organize()
def inbox_loop():
    while True:
        try: import_inbox()
        except Exception: pass
        time.sleep(10)

MEDIA_JSON = os.path.join(ROOT, 'data', 'media.json')
def load_media():
    try:
        with open(MEDIA_JSON, encoding='utf-8') as f: return json.load(f)
    except Exception: return {}
MEDIA = load_media()

def raw_blob(bid):
    for e in EXT.values():
        p = os.path.join(BLOB, bid + e)
        if os.path.exists(p): return p
    return None

def nice_path(bid, ext):
    stem = MEDIA.get(bid)
    if not stem: return None
    if ext == '.mp4': ext = '.m4a'
    return os.path.join(ROOT, *stem.split('/')) + ext

def find_blob(bid):
    if not re.fullmatch(r'[0-9a-f]{32}', bid): return None
    if bid in MEDIA:
        for e in ('.jpg', '.png', '.webp', '.gif', '.m4a', '.webm', '.mp3'):
            p = nice_path(bid, e)
            if p and os.path.exists(p): return p
    return raw_blob(bid)

def organize():
    old, new = os.path.join(ROOT, 'Медиатека'), os.path.join(ROOT, 'media')
    if os.path.isdir(old) and not os.path.exists(new):
        try: os.rename(old, new)
        except Exception as e: print('rename error', e, flush=True)
    n = 0
    for bid in list(MEDIA):
        src = raw_blob(bid)
        if not src: continue
        dst = nice_path(bid, os.path.splitext(src)[1])
        try:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if not os.path.exists(dst): os.replace(src, dst); n += 1
        except Exception as e: print('organize error', bid, e, flush=True)
    if n: print('Разложено по папкам media:', n, flush=True)

# ---------- автообновление с GitHub ----------
import subprocess
RESTART = 3  # код выхода: ЗАПУСК.bat перезапустит сервер
SRV = None
def git(*a):
    return subprocess.run(['git', '-C', ROOT, *a], capture_output=True, text=True, timeout=120)
def update_loop():
    if not os.path.isdir(os.path.join(ROOT, '.git')): return
    while True:
        time.sleep(int(os.environ.get('DL_UPDATE_SEC', '60')))
        try:
            if git('fetch', '-q', 'origin', 'main').returncode: continue
            head, remote = git('rev-parse', 'HEAD').stdout.strip(), git('rev-parse', 'origin/main').stdout.strip()
            if not remote or head == remote: continue
            changed = git('diff', '--name-only', head, remote).stdout.split()
            r = git('merge', '--ff-only', '-q', 'origin/main')
            if r.returncode: print('Обновление не применилось:', r.stderr.strip(), flush=True); continue
            print(time.strftime('%H:%M'), 'Обновление с GitHub:', ', '.join(changed) or '-', flush=True)
            if any(f in ('server.py',) for f in changed) and SRV:
                print('Изменился сервер, перезапускаюсь...', flush=True)
                os.environ['DL_RESTART'] = '1'; threading.Thread(target=SRV.shutdown, daemon=True).start(); return
        except Exception as e:
            print('Ошибка автообновления:', e, flush=True)

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def send_json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0); return self.rfile.read(n)

    def me(self):
        m = re.search(r'(?:^|;\s*)dl_s=([A-Za-z0-9_\-]+)', self.headers.get('Cookie') or '')
        if not m: return None
        with ALOCK:
            a = acc_load(); se = a['sessions'].get(m.group(1))
            if not se or se.get('exp', 0) < time.time(): return None
            u = a['users'].get(se['uid'])
            return {'id': se['uid'], 'name': u['login'], 'admin': bool(u.get('admin'))} if u else None

    def cookie(self, token, age):
        self.send_header('Set-Cookie', f'dl_s={token}; Path=/; Max-Age={age}; HttpOnly; SameSite=Lax')

    def json_auth(self, obj, token=None, age=SESSION_DAYS * 86400, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8')
        if token is not None: self.cookie(token, age)
        self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)

    def send_page(self, name, me=None):
        with open(os.path.join(ROOT, name), encoding='utf-8') as f: html = f.read()
        if me is not None:
            html = html.replace('<script>/*DL_ME*/</script>', '<script>window.DL_ME=' + json.dumps(me, ensure_ascii=False).replace('<', '\\u003c') + '</script>', 1)
        b = html.encode('utf-8')
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ('/', '/index.html'):
            me = self.me()
            return self.send_page('index.html', me) if me else self.send_page('login.html')
        if path == '/login.html':
            self.send_response(302); self.send_header('Location', '/'); self.end_headers(); return
        if path == '/api/me':
            return self.send_json({'user': self.me()})
        if path == '/api/db':
            me = self.me()
            if not me: return self.send_json({'error': 'login'}, 401)
            with LOCK: db = load()
            own = 'data/users/' + me['id']
            return self.send_json({k: v for k, v in db.items() if k != 'gifts' and (not k.startswith('data/users/') or k == own)})
        if path == '/api/gifts':
            me = self.me()
            if not me: return self.send_json({'error': 'login'}, 401)
            with LOCK: db = load()
            return self.send_json({'gifts': (db.get('gifts') or {}).get(me['id'], [])})
        if path == '/api/admin/users':
            me = self.me()
            if not me or not me['admin']: return self.send_json({'error': 'forbidden'}, 403)
            with ALOCK: a = acc_load()
            with LOCK: db = load()
            out = []
            for uid, u in a['users'].items():
                g = (((db.get('data/users/' + uid) or {}).get('shelf') or {}).get('g') or {})
                pend = (db.get('gifts') or {}).get(uid, [])
                out.append({'id': uid, 'login': u['login'], 'admin': bool(u.get('admin')), 'created': u.get('created', 0),
                            'sa': g.get('sa'), 'dr': g.get('dr'), 'pending': [sum(int(x.get('sa', 0)) for x in pend), sum(int(x.get('dr', 0)) for x in pend)]})
            out.sort(key=lambda x: x['login'].lower())
            return self.send_json({'users': out})
        from urllib.parse import unquote
        seg = os.path.normpath(unquote(path)).replace('\\', '/').lstrip('/').split('/')[0].lower()
        if seg in ('data', 'server.py', 'log.txt') or seg.endswith('.bat'):
            return self.send_error(404)
        if path.startswith('/_blob/'):
            p = find_blob(path[7:])
            if not p: return self.send_error(404)
            return self.serve_file(p)
        if path == '/favicon.ico':
            self.send_response(204); self.end_headers(); return
        if path == '/': self.path = '/index.html'
        return super().do_GET()

    def serve_file(self, p):
        size = os.path.getsize(p); ctype = MIME.get(os.path.splitext(p)[1], 'application/octet-stream')
        rng = self.headers.get('Range'); start, end = 0, size - 1
        m = re.match(r'bytes=(\d*)-(\d*)', rng or '')
        if m and (m.group(1) or m.group(2)):
            if m.group(1): start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else size - 1
            else: start = size - int(m.group(2))
            end = min(end, size - 1)
            self.send_response(206); self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        else: self.send_response(200)
        self.send_header('Content-Type', ctype); self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1)); self.send_header('Cache-Control', 'max-age=86400'); self.end_headers()
        with open(p, 'rb') as f:
            f.seek(start); left = end - start + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk: break
                try: self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError): return
                left -= len(chunk)

    def do_POST(self):
        path = self.path.split('?')[0]
        if path in ('/api/register', '/api/login'):
            try: q = json.loads(self.body() or b'{}')
            except Exception: q = {}
            login, pw = str(q.get('login') or '').strip(), str(q.get('password') or '')
            with ALOCK:
                a = acc_load()
                if path == '/api/register':
                    if not LOGIN_RE.fullmatch(login): return self.send_json({'error': 'Логин: от 3 до 20 символов, латиница, цифры, _ . -'}, 400)
                    if len(pw) < 6: return self.send_json({'error': 'Пароль должен быть не короче 6 символов'}, 400)
                    if find_user(a, login)[0]: return self.send_json({'error': 'Такой логин уже занят'}, 409)
                    uid = uuid.uuid4().hex[:12]; salt, h = pw_hash(pw)
                    first = not a['users']
                    a['users'][uid] = {'login': login, 'salt': salt, 'hash': h, 'created': int(time.time())}
                    if first:
                        with LOCK:
                            db = load()
                            if 'data/users/local' in db: db['data/users/' + uid] = db.pop('data/users/local'); save(db)
                else:
                    key = login.lower(); f = FAILS.get(key, [0, 0])
                    if f[1] > time.time(): return self.send_json({'error': 'Слишком много попыток. Подожди пару минут.'}, 429)
                    uid, u = find_user(a, login)
                    if not u or not hmac.compare_digest(pw_hash(pw, u['salt'])[1], u['hash']):
                        f[0] += 1
                        if f[0] >= 8: f = [0, time.time() + 300]
                        FAILS[key] = f
                        time.sleep(0.7); return self.send_json({'error': 'Неверный логин или пароль'}, 401)
                    FAILS.pop(key, None)
                    login = u['login']
                t = new_session(a, uid); acc_save(a)
            return self.json_auth({'ok': True, 'user': {'id': uid, 'name': login}}, t)
        if path == '/api/logout':
            m = re.search(r'(?:^|;\s*)dl_s=([A-Za-z0-9_\-]+)', self.headers.get('Cookie') or '')
            if m:
                with ALOCK:
                    a = acc_load(); a['sessions'].pop(m.group(1), None); acc_save(a)
            return self.json_auth({'ok': True}, '', 0)
        if path == '/api/password':
            me = self.me()
            if not me: return self.send_json({'error': 'login'}, 401)
            try: q = json.loads(self.body() or b'{}')
            except Exception: q = {}
            old, new = str(q.get('old') or ''), str(q.get('new') or '')
            with ALOCK:
                a = acc_load(); u = a['users'][me['id']]
                if not hmac.compare_digest(pw_hash(old, u['salt'])[1], u['hash']):
                    time.sleep(0.7); return self.send_json({'error': 'Старый пароль неверный'}, 401)
                if len(new) < 6: return self.send_json({'error': 'Новый пароль должен быть не короче 6 символов'}, 400)
                u['salt'], u['hash'] = pw_hash(new); acc_save(a)
            return self.send_json({'ok': True})
        if path == '/api/admin/gift':
            me = self.me()
            if not me or not me['admin']: return self.send_json({'error': 'forbidden'}, 403)
            try: q = json.loads(self.body() or b'{}')
            except Exception: q = {}
            try: sa, dr = int(q.get('sa') or 0), int(q.get('dr') or 0)
            except Exception: return self.send_json({'error': 'Суммы должны быть числами'}, 400)
            if sa < 0 or dr < 0 or sa > 1000000 or dr > 100000 or (sa == 0 and dr == 0): return self.send_json({'error': 'Укажи, сколько выдать'}, 400)
            uid = str(q.get('uid') or '')
            with ALOCK: a = acc_load()
            if uid not in a['users']: return self.send_json({'error': 'Нет такого игрока'}, 404)
            g = {'id': uuid.uuid4().hex[:10], 'sa': sa, 'dr': dr, 'from': me['name'], 'note': str(q.get('note') or '')[:120], 'at': int(time.time())}
            with LOCK:
                db = load(); db.setdefault('gifts', {}).setdefault(uid, []).append(g); save(db)
            return self.send_json({'ok': True, 'gift': g})
        if path == '/api/gifts/claim':
            me = self.me()
            if not me: return self.send_json({'error': 'login'}, 401)
            try: ids = set(json.loads(self.body() or b'{}').get('ids') or [])
            except Exception: ids = set()
            with LOCK:
                db = load(); L = (db.get('gifts') or {}).get(me['id'], [])
                got = [x for x in L if x['id'] in ids]; left = [x for x in L if x['id'] not in ids]
                if got:
                    if left: db['gifts'][me['id']] = left
                    else: db['gifts'].pop(me['id'], None)
                    save(db)
            return self.send_json({'gifts': got})
        me = self.me()
        if not me: return self.send_json({'error': 'login'}, 401)
        if path == '/api/db':
            op = json.loads(self.body() or b'{}'); c, i = op.get('c'), op.get('id')
            if not c or not i: return self.send_json({'error': 'bad op'}, 400)
            if c == 'gifts': return self.send_json({'error': 'forbidden'}, 403)
            if c.startswith('data/users/'):
                if c != 'data/users/' + me['id']: return self.send_json({'error': 'forbidden'}, 403)
            elif not me['admin']: return self.send_json({'error': 'Менять общую базу могут только администраторы'}, 403)
            with LOCK:
                db = load(); col = db.setdefault(c, {})
                if op.get('op') == 'set': col[i] = op.get('d')
                elif op.get('op') == 'update':
                    cur = col.get(i) or {}
                    for k, v in (op.get('d') or {}).items():
                        if isinstance(v, dict) and v.get('__delete__'): cur.pop(k, None)
                        else: cur[k] = v
                    col[i] = cur
                elif op.get('op') == 'delete': col.pop(i, None)
                save(db)
            return self.send_json({'ok': True})
        if path == '/api/upload':
            if not me['admin']: return self.send_json({'error': 'forbidden'}, 403)
            q = self.path.split('?', 1)[1] if '?' in self.path else ''
            t = dict(x.split('=', 1) for x in q.split('&') if '=' in x).get('type', '')
            from urllib.parse import unquote
            ext = EXT.get(unquote(t))
            if not ext: return self.send_json({'error': 'unsupported type'}, 400)
            bid = uuid.uuid4().hex; os.makedirs(BLOB, exist_ok=True)
            with open(os.path.join(BLOB, bid + ext), 'wb') as f: f.write(self.body())
            return self.send_json({'id': bid, 'url': '/_blob/' + bid})
        self.send_error(404)

    def do_DELETE(self):
        me = self.me()
        if not me: return self.send_json({'error': 'login'}, 401)
        if not me['admin']: return self.send_json({'error': 'forbidden'}, 403)
        m = re.fullmatch(r'/api/asset/([0-9a-f]{32})', self.path)
        if not m: return self.send_error(404)
        p = find_blob(m.group(1))
        if p: os.remove(p)
        self.send_json({'ok': True})

if __name__ == '__main__':
    backup_once_a_day()
    organize()
    threading.Thread(target=inbox_loop, daemon=True).start()
    srv = SRV = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), H)
    threading.Thread(target=update_loop, daemon=True).start()
    url = f'http://localhost:{PORT}/'
    lan = ''
    try:
        import socket; so = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); so.connect(('10.255.255.255', 1)); lan = so.getsockname()[0]; so.close()
    except Exception: pass
    try: print('Deadlink работает: ' + url + (f'\nС телефона (тот же Wi-Fi): http://{lan}:{PORT}/' if lan and not lan.startswith('127.') else '') + '\nНе закрывай это окно, пока пользуешься сайтом. Остановить: Ctrl+C.', flush=True)
    except Exception: print('Deadlink is running: ' + url, flush=True)
    if '--no-browser' not in sys.argv and not os.environ.get('DL_NOBROWSER'): threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
    if os.environ.get('DL_RESTART'): sys.exit(RESTART)
