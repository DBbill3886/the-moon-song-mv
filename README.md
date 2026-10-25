# The Moon Song — HTML Animation MV

A self-contained, playable HTML canvas music video for **The Moon Song** (from *Her*, 2013).  
Driven purely by audio time via `window.renderAt(t)` / `window.seekTo(t)`.

## Duration

- Exact decoded duration: **109.644626 s**
- Audio primary: `assets/moon-song.m4a` (0 ms offset), with wav / mp3 / aac fallbacks

## Quick start

```bash
# Option A — local HTTP (recommended)
python3 -m http.server 8080
# open http://127.0.0.1:8080/index.html

# Option B — file://
open index.html   # works; data is inlined, images have no crossOrigin
```

## Controls

| Input | Action |
|------|--------|
| Space / click stage | Play / Pause |
| Scrubber | Seek (shot markers on track) |
| ← / → | Seek −5s / +5s (Shift: ±1s) |
| Volume | Master volume |
| EN+ZH / EN / Off | Subtitle mode cycle |
| Glow | Toggle English word glow |
| ⛶ / F | Fullscreen |
| S | Cycle subtitles |

UI auto-hides while playing.

## Architecture

- `index.html` — single self-contained player (inline CSS + embedded `mv-data` + engine)
- `src/engine.js` — modular engine source (same logic as inlined)
- `src/mv-data.js` — `window.MOON_SONG_LYRICS` + `window.MOON_SONG_ENVELOPE`
- `lyrics.json` — lyrics source
- `assets/` — audio + 1280×720 shot plates
- `docs/` — research / audio calibration / shot script
- `qa/preview-01.png` … `preview-08.png` — Playwright stills (1280×720)

### Public API

```js
window.renderAt(t)   // draw frame at time t (seconds)
window.seekTo(t)     // seek audio + render
window.vocalEnvelope(t)
window.pluckEnvelope(t)
window.__moonMV      // debug handle
```

Logical stage: **1920×1080**, CSS cover-scaled to the viewport.

### Animation layers (not Ken Burns)

- Shot plate parallax / breathing / head sway / blink hint / finger tap (frozen 18.60–19.35)
- Walking bob (shot 3)
- Curtain sway, dust (48), film grain, starfield (64)
- Moon halo, ocean waves (shots 4–5), city light trails (shots 3 / 6)
- Amber device rings driven by `vocalEnvelope` / `pluckEnvelope`
- Soft 1.6–2.2 s iris transitions with moon/device shape match

### Shot timeline

| Shot | Time | Plate |
|------|------|-------|
| 01 | 0.00 – 19.35 | desk-intro |
| 02 | 19.35 – 33.80 | window-dusk |
| 03 | 33.80 – 53.50 | skywalk |
| 04 | 53.50 – 70.10 | shore-wide |
| 05 | 70.10 – 87.50 | shore-close |
| 06 | 87.50 – 96.70 | rooftop-night |
| 07 | 96.70 – 109.64 | window-moonlight |

## QA

```bash
python3 scripts/qa_playwright.py
```

Checks: no page/console errors (favicon 404 ignored), `renderAt` at key times, scrub + subtitle modes, desktop + mobile, writes `qa/preview-*.png`.

## Export 1080p60 MP4

```bash
python3 scripts/export_mp4.py
# -> the-moon-song-mv-1080p60.mp4
# 1920×1080 @ 60fps, H.264 CRF 18, AAC from m4a, +faststart
```

Frame-by-frame via Playwright calling `renderAt`, not realtime screencast.

## License / credit

Music: *The Moon Song* — Karen O & Spike Jonze; vocal performance associated with *Her* (Scarlett Johansson as Samantha).  
This project is a non-commercial HTML animation preview / study.
