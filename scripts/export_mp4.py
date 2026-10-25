#!/usr/bin/env python3
"""Frame-by-frame export via window.renderAt -> ffmpeg h264 1080p60."""
import os, sys, time, math, json, base64, socket, threading, http.server, socketserver, subprocess
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

ROOT = Path('/workspace/moon-song-mv')
OUT = ROOT / 'export'
OUT.mkdir(exist_ok=True)
DURATION = 109.644626
FPS = 60
TOTAL = int(math.ceil(DURATION * FPS))  # 6579
W, H = 1920, 1080
AUDIO = ROOT / 'assets' / 'moon-song.m4a'
FINAL = ROOT / 'the-moon-song-mv-1080p60.mp4'
WORKERS = 3
SEG = max(1, TOTAL // WORKERS)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def render_segment(args):
    seg_i, f0, f1, port = args
    os.chdir(ROOT)
    from playwright.sync_api import sync_playwright
    out_path = OUT / f'seg_{seg_i:02d}.h264.mp4'
    log = OUT / f'seg_{seg_i:02d}.log'
    t0 = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path='/usr/bin/google-chrome', headless=True,
            args=['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
                  '--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        page.goto(f'http://127.0.0.1:{port}/index.html?export=1', wait_until='load', timeout=120000)
        page.wait_for_function('() => window.__moonMV && window.__moonMV.state.ready', timeout=120000)
        # Hide UI for clean frames
        page.evaluate('''() => {
          const ui = document.getElementById('mv-ui');
          if (ui) ui.style.display = 'none';
          const boot = document.querySelector('.boot');
          if (boot) boot.style.display = 'none';
          const c = document.getElementById('stage');
          c.style.width = '1920px'; c.style.height = '1080px';
          c.style.left = '0'; c.style.top = '0';
          c._dpr = 1; c.width = 1920; c.height = 1080;
        }''')

        cmd = [
            'ffmpeg', '-y', '-loglevel', 'error',
            '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', str(FPS),
            '-i', 'pipe:0',
            '-an',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-g', str(FPS * 2),
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
            str(out_path)
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        for fi in range(f0, f1):
            t = min(fi / FPS, DURATION)
            b64 = page.evaluate('''(t) => {
              window.renderAt(t);
              return document.getElementById('stage').toDataURL('image/jpeg', 0.92);
            }''', t)
            raw = base64.b64decode(b64.split(',', 1)[1])
            proc.stdin.write(raw)
            if (fi - f0) % 120 == 0:
                msg = f'seg{seg_i} frame {fi}/{f1} ({fi-f0}/{f1-f0}) elapsed {time.time()-t0:.1f}s\n'
                log.write_text((log.read_text() if log.exists() else '') + msg)
                print(msg.strip(), flush=True)
        proc.stdin.close()
        rc = proc.wait()
        browser.close()
    elapsed = time.time() - t0
    result = {'seg': seg_i, 'f0': f0, 'f1': f1, 'path': str(out_path), 'rc': rc, 'elapsed': elapsed}
    (OUT / f'seg_{seg_i:02d}.json').write_text(json.dumps(result))
    print('DONE', result, flush=True)
    return result

def main():
    os.chdir(ROOT)
    port = free_port()
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    print('HTTP', port, 'TOTAL_FRAMES', TOTAL, flush=True)

    jobs = []
    for i in range(WORKERS):
        f0 = i * SEG
        f1 = TOTAL if i == WORKERS - 1 else (i + 1) * SEG
        jobs.append((i, f0, f1, port))

    # ProcessPool can't share easily with playwright+server; run sequential workers in threads instead
    # Actually playwright in threads is OK for separate browsers
    from concurrent.futures import ThreadPoolExecutor
    results = []
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(render_segment, j) for j in jobs]
        for f in as_completed(futs):
            results.append(f.result())
    results.sort(key=lambda r: r['seg'])

    # concat
    lst = OUT / 'concat.txt'
    lst.write_text(''.join(f"file '{Path(r['path']).name}'\n" for r in results))
    video_only = OUT / 'video_only.mp4'
    subprocess.check_call([
        'ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
        '-i', str(lst), '-c', 'copy', str(video_only)
    ], cwd=str(OUT))

    # mux audio (m4a), faststart, trim to duration
    subprocess.check_call([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-i', str(video_only),
        '-i', str(AUDIO),
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k',
        '-t', str(DURATION),
        '-movflags', '+faststart',
        str(FINAL)
    ])
    httpd.shutdown()
    info = subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,r_frame_rate',
        '-of', 'json', str(FINAL)
    ], text=True)
    print('FINAL', FINAL, FINAL.stat().st_size, flush=True)
    print(info, flush=True)
    (OUT / 'export-summary.json').write_text(json.dumps({'results': results, 'final': str(FINAL), 'probe': json.loads(info)}, indent=2))

if __name__ == '__main__':
    main()
