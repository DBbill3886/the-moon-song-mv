#!/usr/bin/env python3
"""Playwright QA for The Moon Song HTML MV."""
import json, os, sys, time, http.server, socketserver, threading, socket, base64, io
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path('/workspace/moon-song-mv')
QA = ROOT / 'qa'
QA.mkdir(exist_ok=True)
os.chdir(ROOT)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

PORT = free_port()
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(('127.0.0.1', PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.2)
print('serving on', PORT, flush=True)

TIMES = [
    ('preview-01', 5.0),
    ('preview-02', 18.9),
    ('preview-03', 27.0),
    ('preview-04', 40.0),
    ('preview-05', 58.0),
    ('preview-06', 78.0),
    ('preview-07', 91.0),
    ('preview-08', 104.0),
]
summary = {'console_errors': [], 'page_errors': [], 'checks': [], 'previews': [], 'shot_at': []}

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path='/usr/bin/google-chrome', headless=True,
        args=['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-gpu'])

    def run_viewport(label, size, mobile=False):
        context = browser.new_context(viewport=size, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
        page = context.new_page()
        def on_console(msg):
            if msg.type != 'error': return
            t = msg.text or ''
            if 'favicon' in t.lower() or '404' in t: return
            summary['console_errors'].append({'type': msg.type, 'text': t, 'view': label})
        page.on('console', on_console)
        page.on('pageerror', lambda exc: summary['page_errors'].append({'text': str(exc), 'view': label}))
        page.goto(f'http://127.0.0.1:{PORT}/index.html', wait_until='load', timeout=60000)
        page.wait_for_function('() => window.__moonMV && window.__moonMV.state.ready', timeout=30000)
        page.wait_for_timeout(300)

        api = page.evaluate('''() => {
          const m = window.__moonMV;
          window.renderAt(5); window.seekTo(10);
          return {hasRender: typeof window.renderAt==='function', hasSeek: typeof window.seekTo==='function',
            duration:m.DURATION, shots:m.SHOTS.length, vocal:window.vocalEnvelope(30),
            pluck:window.pluckEnvelope(1), canvas:[m.canvas.width,m.canvas.height], lastT:m.state.lastT,
            shotAt40:m.shotIndexAt(40)};
        }''')
        summary['checks'].append({'view': label, 'api': api})
        print(label, api, flush=True)

        for mode in ['both', 'en', 'off']:
            page.evaluate('(mode)=>{window.__moonMV.state.subtitleMode=mode; window.renderAt(27);}', mode)
        for t in [0, 19.35, 33.8, 53.5, 70.1, 87.5, 96.7, 109.0]:
            page.evaluate('(t)=>window.seekTo(t)', t)

        if label == 'desktop':
            for name, t in TIMES:
                shot_i = page.evaluate('(t)=>{window.renderAt(t); return window.__moonMV.shotIndexAt(t);}', t)
                b64 = page.evaluate('()=>document.getElementById("stage").toDataURL("image/png")')
                raw = base64.b64decode(b64.split(',',1)[1])
                im = Image.open(io.BytesIO(raw)).convert('RGB').resize((1280, 720), Image.LANCZOS)
                out = QA / f'{name}.png'
                im.save(out, 'PNG')
                summary['previews'].append({'file': str(out), 't': t, 'shotIndex': shot_i})
                summary['shot_at'].append({'t': t, 'shotIndex': shot_i})
                print('wrote', out.name, 't=', t, 'shot', shot_i+1, 'mean', im.resize((1,1)).getpixel((0,0)), flush=True)
        context.close()

    run_viewport('desktop', {'width': 1280, 'height': 720}, False)
    run_viewport('mobile', {'width': 390, 'height': 844}, True)
    browser.close()

httpd.shutdown()
summary['console_error_count'] = len(summary['console_errors'])
summary['page_error_count'] = len(summary['page_errors'])
(QA / 'qa-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps({k: summary[k] for k in ['console_error_count','page_error_count','shot_at','errors'] if k in summary or k=='errors'}, indent=2))
print('errors', summary['console_errors'][:5], 'page', summary['page_errors'][:5])
if summary['page_error_count'] or summary['console_error_count']:
    sys.exit(1)
# diversity check
hashes = set()
for name,_ in TIMES:
    hashes.add((QA/f'{name}.png').read_bytes()[:64])
print('unique_preview_headers', len(hashes))
if len(hashes) < 5:
    sys.exit(2)
print('QA_OK')
