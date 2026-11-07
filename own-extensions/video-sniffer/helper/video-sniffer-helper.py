#!/usr/bin/env python3
"""Local helper for the Video Sniffer extension: runs yt-dlp when the extension asks.

Listens on 127.0.0.1 only and answers only requests that come from a Chrome extension (a website
cannot reach it). yt-dlp is started with an argument list, never through a shell, so a URL or format
from the extension cannot inject commands.
"""
import json
import re
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PORT = 47655
CONFIG_PATH = Path.home() / '.config' / 'video-sniffer-helper' / 'config.json'
DEFAULTS = {
    'output_dir': str(Path.home() / 'Downloads'),
    # Used only for requests that ask for cookies (e.g. YouTube Premium). Example for Flatpak Chrome:
    # "chrome:/home/USER/.var/app/com.google.Chrome/config/google-chrome"
    'cookies_from_browser': '',
    'ytdlp': 'yt-dlp',
}
FORMAT_RE = re.compile(r'^[A-Za-z0-9\[\]<>=!*+/,.()|&_:~^$-]{1,300}$')
MAX_RUNNING = 3

jobs = {}
jobs_lock = threading.Lock()


def load_config():
    cfg = dict(DEFAULTS)
    try:
        cfg.update(json.loads(CONFIG_PATH.read_text()))
    except FileNotFoundError:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(DEFAULTS, indent=2) + '\n')
    except (OSError, ValueError):
        pass
    return cfg


def ytdlp_version(cfg):
    exe = shutil.which(cfg['ytdlp'])
    if not exe:
        return None
    try:
        return subprocess.run([exe, '--version'], capture_output=True, text=True, timeout=10).stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def is_http_url(value):
    u = urlparse(value or '')
    return u.scheme in ('http', 'https') and bool(u.netloc)


def run_job(job_id, cmd):
    job = jobs[job_id]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            job['log'] = line[:200]
            m = re.search(r'\[download\]\s+(\d+(?:\.\d+)?)%', line)
            if m:
                job['progress'] = float(m.group(1))
            m = re.search(r'\[(?:download|Merger|ExtractAudio)\][^"]*?(?:Destination:|Merging formats into)\s+"?(.+?)"?$', line)
            if m:
                job['file'] = Path(m.group(1)).name
        job['status'] = 'done' if proc.wait() == 0 else 'failed'
    except OSError as e:
        job['status'] = 'failed'
        job['log'] = str(e)
    job['finished'] = time.time()


def start_download(body):
    cfg = load_config()
    url = body.get('url')
    if not is_http_url(url):
        return {'ok': False, 'error': 'Not an http(s) URL'}
    exe = shutil.which(cfg['ytdlp'])
    if not exe:
        return {'ok': False, 'error': 'yt-dlp is not installed'}
    with jobs_lock:
        if sum(1 for j in jobs.values() if j['status'] == 'running') >= MAX_RUNNING:
            return {'ok': False, 'error': 'Too many downloads running'}

    out_dir = Path(cfg['output_dir']).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [exe, '--no-playlist', '--newline', '--merge-output-format', 'mp4/mkv', '-o', str(out_dir / '%(title).150B [%(id)s].%(ext)s')]
    fmt = body.get('format')
    if fmt:
        if not FORMAT_RE.match(fmt) or fmt.startswith('-'):
            return {'ok': False, 'error': 'Invalid format'}
        cmd += ['-f', fmt]
    referer = body.get('referer')
    if referer:
        if not is_http_url(referer):
            return {'ok': False, 'error': 'Invalid referer'}
        cmd += ['--referer', referer]
    if body.get('cookies') and cfg['cookies_from_browser']:
        cmd += ['--cookies-from-browser', cfg['cookies_from_browser']]
    cmd += ['--', url]

    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {'id': job_id, 'url': url, 'status': 'running', 'progress': 0.0, 'log': '', 'file': '', 'started': time.time()}
    threading.Thread(target=run_job, args=(job_id, cmd), daemon=True).start()
    return {'ok': True, 'id': job_id}


class Handler(BaseHTTPRequestHandler):
    server_version = 'VideoSnifferHelper'

    def log_message(self, *args):
        pass

    def _allowed(self):
        origin = self.headers.get('Origin', '')
        host = self.headers.get('Host', '')
        return origin.startswith('chrome-extension://') and host in (f'127.0.0.1:{PORT}', f'localhost:{PORT}')

    def _send(self, code, payload):
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', ''))
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204 if self._allowed() else 403, {})

    def do_GET(self):
        if not self._allowed():
            return self._send(403, {'ok': False})
        if self.path == '/ping':
            cfg = load_config()
            return self._send(200, {'ok': True, 'ytdlp': ytdlp_version(cfg), 'output_dir': cfg['output_dir']})
        if self.path == '/jobs':
            with jobs_lock:
                recent = sorted(jobs.values(), key=lambda j: j['started'], reverse=True)[:8]
            return self._send(200, {'ok': True, 'jobs': recent})
        self._send(404, {'ok': False})

    def do_POST(self):
        if not self._allowed() or self.path != '/download':
            return self._send(403, {'ok': False})
        length = int(self.headers.get('Content-Length') or 0)
        if length > 8192:
            return self._send(413, {'ok': False, 'error': 'Too large'})
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            return self._send(400, {'ok': False, 'error': 'Bad JSON'})
        self._send(200, start_download(body if isinstance(body, dict) else {}))


if __name__ == '__main__':
    load_config()
    print(f'Video Sniffer helper on http://127.0.0.1:{PORT} (config: {CONFIG_PATH})')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
