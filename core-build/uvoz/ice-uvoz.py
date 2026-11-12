#!/usr/bin/env python3
"""Ice: uvoz iz drugog browsera (bookmarks, historija, lozinke, dozvole stranica).

Izvori: Chrome, Chromium, Brave, Edge, Vivaldi, Opera, stari Ice (svi profili) i Firefox (bookmarks, historija).
Podaci se DODAJU postojećim u Iceu, ništa se ne briše. Izvorni browser se samo čita (kopije baza).
Ice mora biti zatvoren dok uvoz traje: dodatak "Uvoz" zato pokreće --restart-import, koji zatvori Ice,
uveze i ponovo ga pokrene. Prije uvoza se pravi rezervna kopija izmijenjenih fajlova.

  ice-uvoz.py                      native messaging host (pokreće ga Ice za dodatak "Uvoz")
  ice-uvoz.py --list               pronađeni browseri
  ice-uvoz.py --import <broj> [--only bookmarks,history,passwords,settings]   (Ice zatvoren)
  ice-uvoz.py --restart-import     zatvori Ice, izvrši zakazani uvoz, pokreni Ice
"""
import configparser
import hashlib
import json
import os
import shutil
import signal
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time

HOME = os.environ.get('ICE_IMPORT_HOME') or os.path.expanduser('~')  # ICE_IMPORT_HOME: samo za testove
PROFILE = os.environ.get('ICE_PROFILE') or os.path.join(
    os.environ.get('XDG_CONFIG_HOME') or os.path.join(os.path.expanduser('~'), '.config'), 'ice-browser')
HERE = os.path.dirname(os.path.realpath(__file__))
LAUNCHER = os.environ.get('ICE_LAUNCHER') or os.path.join(os.path.dirname(HERE), 'ice-browser')
PENDING = os.path.join(PROFILE, 'ice-uvoz-zakazano.json')
LAST = os.path.join(PROFILE, 'ice-uvoz-zadnji.json')
CHROME_EPOCH = 11644473600000000  # mikrosekunde između 1601. i 1970.

# keyring: pod kojim imenima browser čuva ključ za lozinke (probaju se redom)
CHROMIUM_FAMILY = [
    ('chrome', 'Google Chrome', ['chrome'], ['.config/google-chrome', '.var/app/com.google.Chrome/config/google-chrome']),
    ('chromium', 'Chromium', ['chromium'], ['.config/chromium', 'snap/chromium/common/chromium',
                                           '.var/app/org.chromium.Chromium/config/chromium']),
    ('brave', 'Brave', ['brave'], ['.config/BraveSoftware/Brave-Browser',
                                   '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser',
                                   'snap/brave/current/.config/BraveSoftware/Brave-Browser']),
    ('edge', 'Microsoft Edge', ['microsoft-edge', 'chromium'], ['.config/microsoft-edge',
                                                                '.var/app/com.microsoft.Edge/config/microsoft-edge']),
    ('vivaldi', 'Vivaldi', ['vivaldi', 'chrome', 'chromium'], ['.config/vivaldi', '.var/app/com.vivaldi.Vivaldi/config/vivaldi']),
    ('opera', 'Opera', ['opera', 'chromium', 'chrome'], ['.config/opera', '.var/app/com.opera.Opera/config/opera']),
    ('ice-stari', 'Ice (stara verzija)', ['chromium'], ['.config/Ice/chromium']),
]
FIREFOX_DIRS = ['.mozilla/firefox', '.config/mozilla/firefox', 'snap/firefox/common/.mozilla/firefox',
                '.var/app/org.mozilla.firefox/.mozilla/firefox']
ALL = ['bookmarks', 'history', 'passwords', 'settings']


def read_json(path, fallback=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return fallback


# ---------- Pronalaženje browsera i profila ----------
def chromium_profiles(root):
    def is_profile(d):
        return os.path.isfile(os.path.join(d, 'Preferences')) and any(
            os.path.isfile(os.path.join(d, f)) for f in ('Bookmarks', 'History', 'Login Data'))
    names = ((read_json(os.path.join(root, 'Local State'), {}) or {}).get('profile') or {}).get('info_cache') or {}
    out = []
    if is_profile(root):
        out.append((root, ''))  # stara Opera: profil je sam folder
    try:
        entries = sorted(os.listdir(root))
    except OSError:
        entries = []
    for e in entries:
        if e != 'Default' and not (e.startswith('Profile ') and e[8:].isdigit()):
            continue
        d = os.path.join(root, e)
        if os.path.isdir(d) and is_profile(d):
            out.append((d, str((names.get(e) or {}).get('name') or ('' if e == 'Default' else e))))
    return out


def firefox_profiles(root):
    ini = configparser.RawConfigParser()
    try:
        ini.read(os.path.join(root, 'profiles.ini'), encoding='utf-8')
    except Exception:
        return []
    out = []
    for sec in ini.sections():
        if not sec.lower().startswith('profile') or not ini.has_option(sec, 'Path'):
            continue
        p = ini.get(sec, 'Path')
        d = p if ini.get(sec, 'IsRelative', fallback='1') == '0' else os.path.join(root, p)
        if os.path.isfile(os.path.join(d, 'places.sqlite')):
            out.append((d, ini.get(sec, 'Name', fallback='')))
    return out


def sources():
    out, seen = [], set()
    own = os.path.realpath(os.path.join(PROFILE, 'Default'))

    def add(kind, key, name, keyring, d, pname, rel):
        real = os.path.realpath(d)
        if real in seen or real == own:
            return
        seen.add(real)
        flavor = 'Flatpak' if rel.startswith('.var/app/') else 'Snap' if rel.startswith('snap/') else ''
        label = ' '.join(x for x in [name, flavor and '(%s)' % flavor, pname and pname != 'default' and '· ' + pname] if x)
        out.append({'id': d, 'kind': kind, 'browser': key, 'label': label, 'keyring': keyring,
                    'can': ['bookmarks', 'history'] if kind == 'firefox' else list(ALL)})

    for key, name, keyring, dirs in CHROMIUM_FAMILY:
        for rel in dirs:
            for d, pname in chromium_profiles(os.path.join(HOME, rel)):
                add('chromium', key, name, keyring, d, pname, rel)
    for rel in FIREFOX_DIRS:
        for d, pname in firefox_profiles(os.path.join(HOME, rel)):
            add('firefox', 'firefox', 'Firefox', [], d, pname, rel)
    return out


# ---------- Pomoćno ----------
class DbCopy:
    """Kopija baze u privremenom folderu (izvor se nikad ne otvara direktno)."""

    def __init__(self, src):
        self.src = src

    def __enter__(self):
        self.tmp = tempfile.mkdtemp(prefix='ice-uvoz-')
        self.path = os.path.join(self.tmp, 'db')
        shutil.copyfile(self.src, self.path)
        if os.path.exists(self.src + '-wal'):  # svježi podaci su u WAL-u
            shutil.copyfile(self.src + '-wal', self.path + '-wal')
        return self.path

    def __exit__(self, *a):
        shutil.rmtree(self.tmp, ignore_errors=True)


def count_urls(nodes):
    return sum(1 if 'url' in n else count_urls(n.get('children', [])) for n in nodes)


def prune(nodes):  # bez praznih foldera
    out = []
    for n in nodes:
        if 'url' in n:
            out.append(n)
        else:
            n['children'] = prune(n.get('children', []))
            if n['children']:
                out.append(n)
    return out


# ---------- Bookmarks ----------
# Zajednički oblik: {bar: [čvorovi], other: [čvorovi]}, čvor = {name, url, added} ili {name, children, added}
def read_chromium_bookmarks(d):
    out = {'bar': [], 'other': []}

    def conv(n):
        if n.get('type') == 'url':
            return {'name': n.get('name') or '', 'url': n['url'], 'added': n.get('date_added')} if n.get('url') else None
        return {'name': n.get('name') or '', 'added': n.get('date_added'),
                'children': [c for c in map(conv, n.get('children') or []) if c]}

    for name in ('AccountBookmarks', 'Bookmarks'):
        roots = (read_json(os.path.join(d, name), {}) or {}).get('roots') or {}
        kids = lambda k: [c for c in map(conv, (roots.get(k) or {}).get('children') or []) if c]
        out['bar'] += kids('bookmark_bar')
        out['other'] += kids('other')
        mobile = kids('synced')
        if mobile:
            out['other'].append({'name': 'Mobilni bookmarksi', 'children': mobile})
    return out


def read_firefox_bookmarks(d):
    with DbCopy(os.path.join(d, 'places.sqlite')) as copy:
        db = sqlite3.connect(copy)
        try:
            rows = db.execute('SELECT b.id, b.type, b.parent, b.title, b.dateAdded, b.guid, p.url FROM moz_bookmarks b '
                              'LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position').fetchall()
        finally:
            db.close()
    kids = {}
    for r in rows:
        kids.setdefault(r[2], []).append(r)

    def conv(r):
        _id, typ, _parent, title, added, _guid, url = r
        when = str(int(added) + CHROME_EPOCH) if added else None
        if typ == 1:
            return {'name': title or url, 'url': url, 'added': when} if url and not url.lower().startswith('place:') else None
        if typ == 2:
            return {'name': title or '', 'added': when, 'children': [c for c in map(conv, kids.get(_id, [])) if c]}
        return None  # razdjelnik

    def root(guid):
        for r in rows:
            if r[5] == guid:
                return [c for c in map(conv, kids.get(r[0], [])) if c]
        return []

    out = {'bar': root('toolbar_____'), 'other': root('menu________') + root('unfiled_____')}
    mobile = root('mobile______')
    if mobile:
        out['other'].append({'name': 'Mobilni bookmarksi', 'children': mobile})
    return out


def import_bookmarks(src, ice):
    tree = read_firefox_bookmarks(src['id']) if src['kind'] == 'firefox' else read_chromium_bookmarks(src['id'])
    tree['bar'], tree['other'] = prune(tree['bar']), prune(tree['other'])
    total = count_urls(tree['bar']) + count_urls(tree['other'])
    if not total:
        return 'nema bookmarksa'
    now = str(int(time.time() * 1000000) + CHROME_EPOCH)

    def to_chromium(n):
        if 'url' in n:
            return {'type': 'url', 'name': n['name'], 'url': n['url'], 'date_added': n.get('added') or now}
        return {'type': 'folder', 'name': n['name'], 'date_added': n.get('added') or now, 'date_modified': '0',
                'children': [to_chromium(c) for c in n['children']]}

    path = os.path.join(ice, 'Bookmarks')
    data = read_json(path, None) or {'roots': {}, 'version': 1}
    data.setdefault('roots', {})
    root_names = {'bookmark_bar': 'Bookmarks bar', 'other': 'Other bookmarks', 'synced': 'Mobile bookmarks'}
    for k, name in root_names.items():
        if not isinstance(data['roots'].get(k), dict):
            data['roots'][k] = {'children': [], 'name': name, 'type': 'folder', 'date_added': now, 'date_modified': '0'}
        data['roots'][k].setdefault('children', [])

    def ice_count(n):
        return 1 if n.get('type') == 'url' else sum(ice_count(c) for c in n.get('children') or [])

    if not any(ice_count(data['roots'][k]) for k in root_names):
        # Ice još nema bookmarksa: isti raspored kao u izvornom browseru
        data['roots']['bookmark_bar']['children'] = [to_chromium(n) for n in tree['bar']]
        data['roots']['other']['children'] = [to_chromium(n) for n in tree['other']]
        where = 'raspored kao u izvoru'
    else:
        # Ice već ima bookmarkse: uvezeni idu u zaseban folder na traci (ponovni uvoz ga zamjenjuje)
        name = 'Uvezeno iz ' + src['label']
        kids = [to_chromium(n) for n in tree['bar']]
        if tree['other']:
            kids.append({'type': 'folder', 'name': 'Ostali bookmarksi', 'date_added': now, 'date_modified': '0',
                         'children': [to_chromium(n) for n in tree['other']]})
        bar = data['roots']['bookmark_bar']['children']
        folder = {'type': 'folder', 'name': name, 'date_added': now, 'date_modified': now, 'children': kids}
        for i, n in enumerate(bar):
            if n.get('type') == 'folder' and n.get('name') == name:
                bar[i] = folder
                break
        else:
            bar.append(folder)
        where = 'folder "%s" na traci' % name

    counter = [0]

    def renum(n):
        counter[0] += 1
        n['id'] = str(counter[0])
        for c in n.get('children') or []:
            renum(c)

    for k in root_names:
        renum(data['roots'][k])
    data.pop('checksum', None)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=3, ensure_ascii=False)
    try:
        os.remove(os.path.join(ice, 'Bookmarks.bak'))
    except OSError:
        pass
    return '%d bookmarksa (%s)' % (total, where)


# ---------- Historija ----------
# Dodaju se samo adrese koje Ice još nema, zajedno s njihovim posjetama; postojeće ostaju netaknute.
def import_history(src, ice):
    src_file = os.path.join(src['id'], 'places.sqlite' if src['kind'] == 'firefox' else 'History')
    if not os.path.isfile(src_file):
        return 'nema historije'
    with DbCopy(src_file) as copy:
        db = sqlite3.connect(os.path.join(ice, 'History'), isolation_level=None)
        try:
            db.execute('ATTACH DATABASE ? AS src', (copy,))
            max_id = db.execute('SELECT COALESCE(MAX(id), 0) FROM urls').fetchone()[0]
            db.execute('BEGIN')
            try:
                if src['kind'] == 'firefox':
                    db.execute('''INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden)
                        SELECT p.url, COALESCE(p.title, ''), p.visit_count, COALESCE(p.typed, 0), p.last_visit_date + ?, 0
                        FROM src.moz_places p
                        WHERE p.last_visit_date IS NOT NULL AND p.visit_count > 0
                          AND (p.url LIKE 'http://%' OR p.url LIKE 'https://%')
                          AND NOT EXISTS (SELECT 1 FROM main.urls m WHERE m.url = p.url)''', (CHROME_EPOCH,))
                    # 805306368 = početak i kraj lanca (posjeta se vidi u historiji); 1 = ukucana adresa
                    cur = db.execute('''INSERT INTO visits (url, visit_time, from_visit, transition, segment_id, visit_duration)
                        SELECT m.id, v.visit_date + ?, 0, 805306368 + (CASE WHEN v.visit_type = 2 THEN 1 ELSE 0 END), 0, 0
                        FROM src.moz_historyvisits v JOIN src.moz_places p ON p.id = v.place_id
                        JOIN main.urls m ON m.url = p.url WHERE m.id > ?''', (CHROME_EPOCH, max_id))
                else:
                    db.execute('''INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden)
                        SELECT s.url, s.title, s.visit_count, s.typed_count, s.last_visit_time, s.hidden
                        FROM src.urls s WHERE NOT EXISTS (SELECT 1 FROM main.urls m WHERE m.url = s.url)''')
                    cur = db.execute('''INSERT INTO visits (url, visit_time, from_visit, transition, segment_id, visit_duration)
                        SELECT m.id, v.visit_time, 0, v.transition, 0, v.visit_duration
                        FROM src.visits v JOIN src.urls s ON s.id = v.url JOIN main.urls m ON m.url = s.url
                        WHERE m.id > ?''', (max_id,))
                visits = cur.rowcount
                added = db.execute('SELECT count(*) FROM urls WHERE id > ?', (max_id,)).fetchone()[0]
                db.execute('COMMIT')
            except Exception:
                db.execute('ROLLBACK')
                raise
        finally:
            db.close()
    return '%d novih adresa, %d posjeta' % (added, visits)


# ---------- Lozinke (Chromium porodica) ----------
KEY_PY_APPS = {}


def keyring_secret(app, create=False):
    """Ključ browsera iz GNOME keyringa (libsecret). None ako ga nema."""
    env = os.environ.get('ICE_TEST_KEY_' + app.upper().replace('-', '_'))  # samo za testove
    if env is not None:
        return env
    if app in KEY_PY_APPS and not create:
        return KEY_PY_APPS[app]
    secret = None
    try:
        import gi
        gi.require_version('Secret', '1')
        from gi.repository import Secret
        svc = Secret.Service.get_sync(Secret.ServiceFlags.NONE)
        flags = Secret.SearchFlags.ALL | Secret.SearchFlags.UNLOCK | Secret.SearchFlags.LOAD_SECRETS
        items = svc.search_sync(None, {'application': app}, flags, None)
        if items:
            secret = items[0].get_secret().get_text()
        elif create:
            import secrets as pysecrets
            schema = Secret.Schema.new('chrome_libsecret_os_crypt_password_v2', Secret.SchemaFlags.DONT_MATCH_NAME,
                                       {'application': Secret.SchemaAttributeType.STRING})
            secret = pysecrets.token_urlsafe(16)
            Secret.password_store_sync(schema, {'application': app}, Secret.COLLECTION_DEFAULT,
                                       'Chromium Safe Storage', secret, None)
    except Exception as e:
        raise RuntimeError('ne mogu pročitati keyring (treba python3-gi i gir1.2-secret-1): %s' % e)
    KEY_PY_APPS[app] = secret
    return secret


def derive(secret):
    if isinstance(secret, str):
        secret = secret.encode('utf-8')
    return hashlib.pbkdf2_hmac('sha1', secret, b'saltysalt', 1, 16)


IV = b' ' * 16


def _aes(key, data, decrypt):
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        c = Cipher(algorithms.AES(key), modes.CBC(IV))
        op = c.decryptor() if decrypt else c.encryptor()
        return op.update(data) + op.finalize()
    except ImportError:
        r = subprocess.run(['openssl', 'enc', '-aes-128-cbc', '-d' if decrypt else '-e', '-nopad', '-nosalt',
                            '-K', key.hex(), '-iv', IV.hex()], input=data, capture_output=True)
        if r.returncode != 0:
            raise RuntimeError('openssl: ' + r.stderr.decode('utf-8', 'replace')[:120])
        return r.stdout


def decrypt_value(blob, keys):
    """keys: {b'v10': ključ, b'v11': ključ}. Vraća bajtove lozinke ili baca grešku."""
    blob = bytes(blob)
    key = keys.get(blob[:3])
    body = blob[3:]
    if key is None or not body or len(body) % 16:
        raise ValueError('nepoznat format')
    plain = _aes(key, body, True)
    pad = plain[-1]
    if pad < 1 or pad > 16 or plain[-pad:] != bytes([pad]) * pad:
        raise ValueError('pogrešan ključ')
    plain = plain[:-pad]
    plain.decode('utf-8')  # pogrešan ključ daje neispravan tekst
    return plain


def encrypt_value(plain, key):
    pad = 16 - len(plain) % 16
    return b'v11' + _aes(key, plain + bytes([pad]) * pad, False)


def import_passwords(src, ice):
    if src['kind'] != 'chromium':
        return 'nije podržano za ovaj browser'
    files = [f for f in (os.path.join(src['id'], n) for n in ('Login Data', 'Login Data For Account')) if os.path.isfile(f)]
    if not files:
        return 'nema lozinki'
    candidates = []
    for app in src['keyring']:
        s = keyring_secret(app)
        if s is not None:
            candidates.append({b'v10': derive('peanuts'), b'v11': derive(s)})
    if not candidates:
        candidates.append({b'v10': derive('peanuts')})  # bez keyringa browser koristi samo v10
    ice_key = derive(keyring_secret('chromium', create=True))

    def reencrypt(blob):
        for keys in candidates:
            try:
                return encrypt_value(decrypt_value(blob, keys), ice_key)
            except Exception:
                continue
        raise ValueError('ključ ne odgovara')

    out = sqlite3.connect(os.path.join(ice, 'Login Data'), isolation_level=None)
    added = failed = never = empty = kept = 0
    try:
        info = [r for r in out.execute('PRAGMA table_info(logins)').fetchall() if r[1] != 'id']  # cid,name,type,notnull,dflt,pk
        out.execute('BEGIN')
        try:
            for path in files:
                with DbCopy(path) as copy:
                    db = sqlite3.connect(copy)
                    try:
                        have = {r[1] for r in db.execute('PRAGMA table_info(logins)').fetchall()}
                        use = [r[1] for r in info if r[1] in have]
                        # Obavezne kolone koje izvor (starija verzija) nema dobijaju praznu vrijednost
                        fill = [r for r in info if r[1] not in have and r[3] and r[4] is None]
                        blank = lambda r: 0 if any(t in (r[2] or '').upper() for t in ('INT', 'BOOL')) else (
                            b'' if 'BLOB' in (r[2] or '').upper() else '')
                        cols = use + [r[1] for r in fill]
                        ins = 'INSERT OR IGNORE INTO logins (%s) VALUES (%s)' % (','.join(cols), ','.join('?' * len(cols)))
                        pw, bl = use.index('password_value'), use.index('blacklisted_by_user')
                        for row in db.execute('SELECT %s FROM logins' % ','.join(use)):
                            row = list(row)
                            is_never = bool(row[bl])
                            if not is_never:
                                if not row[pw]:
                                    empty += 1
                                    continue
                                try:
                                    row[pw] = reencrypt(row[pw])
                                except Exception:
                                    failed += 1
                                    continue
                            n = out.execute(ins, row + [blank(r) for r in fill]).rowcount
                            if not n:
                                kept += 1
                            elif is_never:
                                never += 1
                            else:
                                added += 1
                    finally:
                        db.close()
            if failed and not added:
                raise RuntimeError('nijedna lozinka se nije dala dešifrovati (ključ browsera nije u keyringu?)')
            out.execute('COMMIT')
        except Exception:
            out.execute('ROLLBACK')
            raise
    finally:
        out.close()
    parts = ['%d lozinki' % added]
    if never:
        parts.append('%d "nikad ne spremaj"' % never)
    if kept:
        parts.append('%d već postoji u Iceu' % kept)
    if empty:
        parts.append('%d bez lozinke (passkey i sl.)' % empty)
    if failed:
        parts.append('%d NIJE uspjelo' % failed)
    return ', '.join(parts)


# ---------- Postavke stranica (Chromium porodica): dozvole i zoom; Iceove postojeće imaju prednost ----------
def import_settings(src, ice):
    if src['kind'] != 'chromium':
        return 'nije podržano za ovaj browser'
    cp = read_json(os.path.join(src['id'], 'Preferences'), None)
    if not isinstance(cp, dict):
        return 'nema postavki'
    path = os.path.join(ice, 'Preferences')
    ip = read_json(path, None)
    if not isinstance(ip, dict):
        return 'Iceove postavke nisu čitljive, preskočeno'
    types = ['geolocation', 'notifications', 'media_stream_camera', 'media_stream_mic', 'clipboard', 'midi_sysex',
             'popups', 'sound', 'automatic_downloads']
    ex = ((cp.get('profile') or {}).get('content_settings') or {}).get('exceptions') or {}
    mine = ip.setdefault('profile', {}).setdefault('content_settings', {}).setdefault('exceptions', {})
    n = 0
    for t in types:
        if not isinstance(ex.get(t), dict):
            continue
        cur = mine.get(t) if isinstance(mine.get(t), dict) else {}
        n += sum(1 for k in ex[t] if k not in cur)
        merged = dict(ex[t])
        merged.update(cur)
        mine[t] = merged
    zoom = (cp.get('partition') or {}).get('per_host_zoom_levels')
    if isinstance(zoom, dict):
        z = ip.setdefault('partition', {}).setdefault('per_host_zoom_levels', {})
        for part, hosts in zoom.items():
            if isinstance(hosts, dict):
                merged = dict(hosts)
                merged.update(z.get(part) if isinstance(z.get(part), dict) else {})
                z[part] = merged
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(ip, f, ensure_ascii=False)
    return '%d dozvola po stranicama, zoom' % n


STEPS = {'bookmarks': ('bookmarks', import_bookmarks), 'history': ('historija', import_history),
         'passwords': ('lozinke', import_passwords), 'settings': ('postavke', import_settings)}


def import_browser(source_id, what=None, log=lambda *_: None):
    src = next((s for s in sources() if s['id'] == source_id), None)
    if not src:
        raise RuntimeError('Izvorni browser nije pronađen.')
    todo = [k for k in ALL if k in src['can'] and (not what or k in what)]
    if not todo:
        raise RuntimeError('Ništa nije odabrano za uvoz.')
    ice = os.path.join(PROFILE, 'Default')
    if not os.path.isdir(ice):
        raise RuntimeError('Ice profil ne postoji (%s). Pokreni Ice jednom pa ponovi.' % ice)
    # Rezervna kopija svega što se mijenja
    backup = os.path.join(PROFILE, 'backup-uvoz-' + time.strftime('%Y-%m-%dT%H-%M-%S'))
    os.makedirs(backup, exist_ok=True)
    for f in ('Bookmarks', 'History', 'History-wal', 'Login Data', 'Preferences'):
        if os.path.isfile(os.path.join(ice, f)):
            shutil.copy2(os.path.join(ice, f), os.path.join(backup, f))
    report = {}
    for k in todo:
        name, fn = STEPS[k]
        try:
            report[name] = fn(src, ice)
        except Exception as e:
            report[name] = 'GREŠKA: %s' % e
        log('  %-10s %s' % (name, report[name]))
    return {'label': src['label'], 'report': report, 'backup': backup,
            'failed': any(v.startswith('GREŠKA') for v in report.values())}


# ---------- Ice proces ----------
def ice_pid():
    try:
        pid = int(os.readlink(os.path.join(PROFILE, 'SingletonLock')).rsplit('-', 1)[-1])
        os.kill(pid, 0)
        return pid
    except Exception:
        return None


def restart_import():
    job = read_json(PENDING, None)
    try:
        os.remove(PENDING)  # prije uvoza: greška ne smije ponavljati uvoz
    except OSError:
        pass
    pid = ice_pid()
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        for _ in range(120):
            if not ice_pid():
                break
            time.sleep(0.25)
        time.sleep(1.5)  # da Ice završi upis profila
    out = {'when': int(time.time() * 1000)}
    if ice_pid():
        out['error'] = 'Ice se nije zatvorio, uvoz nije izvršen.'
    elif not job:
        out['error'] = 'Nema zakazanog uvoza.'
    else:
        try:
            r = import_browser(job.get('source'), job.get('what'))
            out.update(label=r['label'], report=r['report'], backup=r['backup'])
            if not r['report'].get('bookmarks', 'GREŠKA').startswith(('GREŠKA', 'nema')):
                show_bookmark_bar()
        except Exception as e:
            out['error'] = str(e)
    with open(LAST, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    if not ice_pid() and os.path.exists(LAUNCHER):
        env = dict(os.environ)
        subprocess.Popen([LAUNCHER], env=env, start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def show_bookmark_bar():
    """Poslije uvoza bookmarksa traka se uključi (Ctrl+Shift+B je i dalje pali/gasi)."""
    path = os.path.join(PROFILE, 'Default', 'Preferences')
    p = read_json(path, None)
    if isinstance(p, dict):
        p.setdefault('bookmark_bar', {})['show_on_all_tabs'] = True
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(p, f, ensure_ascii=False)


# ---------- Native messaging host ----------
def host():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return
    msg = json.loads(sys.stdin.buffer.read(struct.unpack('<I', raw)[0]).decode('utf-8'))

    def send(obj):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('<I', len(b)) + b)
        sys.stdout.buffer.flush()

    try:
        cmd = msg.get('cmd')
        if cmd == 'list':
            # putanje ključeva i sl. ne idu u dodatak, samo id, naziv i šta se može uvesti
            send({'ok': True, 'sources': [{'id': s['id'], 'label': s['label'], 'can': s['can']} for s in sources()],
                  'last': read_json(LAST, None)})
        elif cmd == 'start':
            src = next((s for s in sources() if s['id'] == msg.get('source')), None)
            if not src:
                raise RuntimeError('Izvorni browser nije pronađen.')
            what = [w for w in (msg.get('what') or []) if w in src['can']]
            if not what:
                raise RuntimeError('Ništa nije odabrano za uvoz.')
            os.makedirs(PROFILE, exist_ok=True)
            with open(PENDING, 'w', encoding='utf-8') as f:
                json.dump({'source': src['id'], 'what': what}, f)
            send({'ok': True})
            # Uvoz traži zatvoren Ice: odvojeni proces ga zatvara, uvozi i pokreće ponovo
            subprocess.Popen([sys.executable, os.path.realpath(__file__), '--restart-import'], start_new_session=True,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            raise RuntimeError('Nepoznata komanda.')
    except Exception as e:
        send({'ok': False, 'error': str(e)})


def main(argv):
    if '--list' in argv:
        lst = sources()
        if not lst:
            print('Nije pronađen nijedan drugi browser.')
        for i, s in enumerate(lst, 1):
            print('%2d  %s  [%s]' % (i, s['label'], ', '.join(s['can'])))
    elif '--list-json' in argv:  # za testove
        print(json.dumps(sources(), ensure_ascii=False))
    elif '--import' in argv:
        if ice_pid():
            sys.exit('Zatvori Ice prije uvoza (ili koristi dodatak "Uvoz" u Ice panelu).')
        lst = sources()
        arg = argv[argv.index('--import') + 1] if len(argv) > argv.index('--import') + 1 else ''
        src = lst[int(arg) - 1] if arg.isdigit() and 0 < int(arg) <= len(lst) else next((s for s in lst if s['id'] == arg), None)
        if not src:
            sys.exit('Nepoznat izvor. Spisak: --list')
        only = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
        print('Uvoz iz: ' + src['label'])
        r = import_browser(src['id'], only, print)
        print('Rezervna kopija: ' + r['backup'])
        if '--json' in argv:
            print('JSON ' + json.dumps(r, ensure_ascii=False))
        sys.exit(1 if r['failed'] else 0)
    elif '--restart-import' in argv:
        restart_import()
    else:
        host()


if __name__ == '__main__':
    main(sys.argv[1:])
