/* The Moon Song — HTML Canvas MV engine
 * window.renderAt(t) / window.seekTo(t) — pure time-driven renderer
 * Logical 1920x1080, cover-scaled. file:// safe (no crossOrigin on images).
 */
(function () {
  'use strict';

  var W = 1920, H = 1080;
  var DURATION = (window.MOON_SONG_LYRICS && window.MOON_SONG_LYRICS.meta &&
    window.MOON_SONG_LYRICS.meta.exactDuration) || 109.644626;
  var ENV = window.MOON_SONG_ENVELOPE || { dt: 0.05, vocal: [], pluck: [] };
  var LYRICS = window.MOON_SONG_LYRICS || { lines: [], cues: [], meta: {} };

  var SHOTS = [
    { id: 1, start: 0.00, end: 19.35, src: 'assets/shot-01-desk-intro.jpg',
      moon: [0.96, 0.09], device: [0.50, 0.59],
      tags: ['desk', 'curtain', 'finger', 'dust', 'indoor'] },
    { id: 2, start: 19.35, end: 33.80, src: 'assets/shot-02-window-dusk.jpg',
      moon: [0.85, 0.42], device: [0.60, 0.60],
      tags: ['window', 'curtain', 'breathe', 'dust', 'indoor'] },
    { id: 3, start: 33.80, end: 53.50, src: 'assets/shot-03-skywalk.jpg',
      moon: [0.85, 0.19], device: [0.46, 0.74],
      tags: ['walk', 'city', 'stars', 'trails'] },
    { id: 4, start: 53.50, end: 70.10, src: 'assets/shot-04-shore-wide.jpg',
      moon: [0.84, 0.22], device: [0.48, 0.77],
      tags: ['shore', 'waves', 'stars', 'halo'] },
    { id: 5, start: 70.10, end: 87.50, src: 'assets/shot-05-shore-close.jpg',
      moon: [0.82, 0.19], device: [0.62, 0.73],
      tags: ['shore', 'waves', 'stars', 'halo', 'breathe'] },
    { id: 6, start: 87.50, end: 96.70, src: 'assets/shot-06-rooftop-night.jpg',
      moon: [0.83, 0.16], device: [0.37, 0.78],
      tags: ['rooftop', 'city', 'stars', 'trails', 'halo'] },
    { id: 7, start: 96.70, end: 109.64, src: 'assets/shot-07-window-moonlight.jpg',
      moon: [0.85, 0.20], device: [0.47, 0.76],
      tags: ['window', 'curtain', 'dust', 'stars', 'halo', 'indoor', 'breathe'] }
  ];
  var TRANS_DUR = [0, 1.9, 2.0, 2.1, 1.8, 2.0, 2.2];

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoother(t) {
    t = clamp(t, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  var TAU = Math.PI * 2;

  function mulberry32(a) {
    return function () {
      var t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleEnv(arr, t) {
    if (!arr || !arr.length) return 0;
    var dt = ENV.dt || 0.05;
    var i = t / dt;
    var i0 = Math.floor(i);
    if (i0 < 0) return arr[0] || 0;
    if (i0 >= arr.length - 1) return arr[arr.length - 1] || 0;
    return lerp(arr[i0], arr[i0 + 1], i - i0);
  }
  function vocalEnvelope(t) { return sampleEnv(ENV.vocal, t); }
  function pluckEnvelope(t) { return sampleEnv(ENV.pluck, t); }
  window.vocalEnvelope = vocalEnvelope;
  window.pluckEnvelope = pluckEnvelope;

  function shotIndexAt(t) {
    t = clamp(t, 0, DURATION);
    for (var i = 0; i < SHOTS.length; i++) {
      if (t < SHOTS[i].end - 1e-9 || i === SHOTS.length - 1) return i;
    }
    return SHOTS.length - 1;
  }

  function transitionInfo(t) {
    for (var i = 1; i < SHOTS.length; i++) {
      var boundary = SHOTS[i].start;
      var dur = TRANS_DUR[i] || 1.9;
      var half = dur / 2;
      var a = boundary - half, b = boundary + half;
      if (t >= a && t < b) {
        return { from: i - 1, to: i, u: smoother((t - a) / dur), boundary: boundary, dur: dur };
      }
    }
    return null;
  }

  var DUST = [], STARS = [], TRAILS = [];
  (function initParticles() {
    var rd = mulberry32(0x4D304E31);
    var i, a;
    for (i = 0; i < 48; i++) {
      DUST.push({
        x: rd(), y: rd(),
        r: 0.6 + rd() * 1.8,
        sp: 0.004 + rd() * 0.012,
        ph: rd() * TAU,
        drift: (rd() - 0.5) * 0.02
      });
    }
    for (i = 0; i < 64; i++) {
      STARS.push({
        x: rd(), y: rd() * 0.55,
        r: 0.4 + rd() * 1.6,
        tw: 0.5 + rd() * 2.5,
        ph: rd() * TAU,
        bright: 0.35 + rd() * 0.65
      });
    }
    for (i = 0; i < 28; i++) {
      TRAILS.push({
        x: rd(), y: 0.55 + rd() * 0.35,
        len: 0.02 + rd() * 0.08,
        sp: 0.01 + rd() * 0.04,
        ph: rd(),
        warm: rd() > 0.45
      });
    }
  })();

  /* ---------- DOM / canvas ---------- */
  var canvas, ctx, audio, ui;
  var images = {};
  var imagesReady = false;
  var state = {
    playing: false,
    subtitleMode: 'both', // 'both' | 'en' | 'off'
    wordGlow: true,
    volume: 0.9,
    hideUI: false,
    lastT: 0,
    pointerActive: false,
    uiTimer: null,
    ready: false
  };

  function loadImages(cb) {
    var pending = SHOTS.length;
    var done = function () {
      pending--;
      if (pending <= 0) { imagesReady = true; if (cb) cb(); }
    };
    SHOTS.forEach(function (s) {
      var img = new Image();
      // IMPORTANT: no crossOrigin — required for file://
      img.onload = done;
      img.onerror = function () { console.warn('image fail', s.src); done(); };
      img.src = s.src;
      images[s.id] = img;
    });
  }

  function coverDraw(ctx2, img, dx, dy, dw, dh, parallaxX, parallaxY, scale) {
    if (!img || !img.complete || !img.naturalWidth) {
      ctx2.fillStyle = '#1a1420';
      ctx2.fillRect(dx, dy, dw, dh);
      return;
    }
    scale = scale || 1.08;
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var ir = iw / ih, dr = dw / dh;
    var sw, sh, sx, sy;
    if (ir > dr) { sh = ih; sw = ih * dr; }
    else { sw = iw; sh = iw / dr; }
    // Extra zoom for parallax room
    sw /= scale; sh /= scale;
    sx = (iw - sw) * 0.5 + (parallaxX || 0) * (iw - sw) * 0.5;
    sy = (ih - sh) * 0.5 + (parallaxY || 0) * (ih - sh) * 0.5;
    sx = clamp(sx, 0, Math.max(0, iw - sw));
    sy = clamp(sy, 0, Math.max(0, ih - sh));
    ctx2.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function hasTag(shot, tag) {
    return shot.tags && shot.tags.indexOf(tag) >= 0;
  }

  function localT(shot, t) {
    return Math.max(0, t - shot.start);
  }

  function plateMotion(shot, t) {
    var lt = localT(shot, t);
    var pause = (t >= 18.60 && t <= 19.35);
    var breath = pause ? 0 : Math.sin(t * 1.15) * 0.0035;
    var sway = pause ? 0 : Math.sin(t * 0.55) * 0.004;
    var bob = 0, walkX = 0;
    if (hasTag(shot, 'walk')) {
      bob = Math.sin(lt * 5.2) * 0.006;
      walkX = lt * 0.0045;
    }
    var push = 0;
    if (shot.id === 1) push = smoother(clamp(lt / 14, 0, 1)) * 0.03; // slow push-in
    if (shot.id === 5) push = smoother(clamp(lt / 12, 0, 1)) * 0.02;
    if (shot.id === 7) push = smoother(clamp(lt / 10, 0, 1)) * 0.015;
    var scale = 1.10 + push + (pause ? 0 : breath * 0.4);
    var px = sway * 2 + walkX;
    var py = breath * 2 + bob - push * 0.3;
    if (hasTag(shot, 'breathe') || hasTag(shot, 'finger') || hasTag(shot, 'desk')) {
      py += breath;
      px += sway;
    }
    // Finger tap freeze during silence
    var tap = 0;
    if (hasTag(shot, 'finger') && !pause) {
      tap = pluckEnvelope(t) * 0.004;
      py += tap;
    }
    return { scale: scale, px: px, py: py, pause: pause, breath: breath, bob: bob };
  }

  /* ---------- overlay layers ---------- */
  function drawDust(ctx2, t, alpha, pause) {
    if (alpha <= 0.01) return;
    ctx2.save();
    for (var i = 0; i < DUST.length; i++) {
      var d = DUST[i];
      var speed = pause ? 0.05 : 1;
      var x = ((d.x + d.drift * t * speed) % 1 + 1) % 1;
      var y = ((d.y - d.sp * t * speed + Math.sin(t * 0.4 + d.ph) * 0.01) % 1 + 1) % 1;
      var a = alpha * (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.2 + d.ph)));
      if (pause) a *= 0.55;
      ctx2.fillStyle = 'rgba(255,220,170,' + (a * 0.55).toFixed(3) + ')';
      ctx2.beginPath();
      ctx2.arc(x * W, y * H, d.r * (pause ? 0.85 : 1), 0, TAU);
      ctx2.fill();
    }
    ctx2.restore();
  }

  function drawStars(ctx2, t, alpha) {
    if (alpha <= 0.01) return;
    ctx2.save();
    for (var i = 0; i < STARS.length; i++) {
      var s = STARS[i];
      var tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph));
      var a = alpha * s.bright * tw;
      ctx2.fillStyle = 'rgba(230,236,255,' + a.toFixed(3) + ')';
      ctx2.beginPath();
      ctx2.arc(s.x * W, s.y * H, s.r, 0, TAU);
      ctx2.fill();
      if (s.r > 1.2) {
        ctx2.strokeStyle = 'rgba(230,236,255,' + (a * 0.35).toFixed(3) + ')';
        ctx2.lineWidth = 0.6;
        ctx2.beginPath();
        ctx2.moveTo(s.x * W - s.r * 2.2, s.y * H);
        ctx2.lineTo(s.x * W + s.r * 2.2, s.y * H);
        ctx2.moveTo(s.x * W, s.y * H - s.r * 2.2);
        ctx2.lineTo(s.x * W, s.y * H + s.r * 2.2);
        ctx2.stroke();
      }
    }
    ctx2.restore();
  }

  function drawMoonHalo(ctx2, shot, t, alpha) {
    if (alpha <= 0.01) return;
    var mx = shot.moon[0] * W, my = shot.moon[1] * H;
    var pulse = 1 + 0.04 * Math.sin(t * 0.7);
    var g = ctx2.createRadialGradient(mx, my, 8, mx, my, 180 * pulse);
    g.addColorStop(0, 'rgba(255,240,200,' + (0.28 * alpha).toFixed(3) + ')');
    g.addColorStop(0.35, 'rgba(255,220,160,' + (0.12 * alpha).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx2.fillStyle = g;
    ctx2.beginPath();
    ctx2.arc(mx, my, 180 * pulse, 0, TAU);
    ctx2.fill();
  }

  function drawDeviceRings(ctx2, shot, t, alpha) {
    if (alpha <= 0.01) return;
    var dx = shot.device[0] * W, dy = shot.device[1] * H;
    var pause = (t >= 18.60 && t <= 19.35);
    var v = vocalEnvelope(t);
    var p = pluckEnvelope(t);
    if (pause) { v *= 0.15; p *= 0.05; }
    var base = 18 + v * 55 + p * 30;
    ctx2.save();
    for (var i = 0; i < 4; i++) {
      var expand = (t * (0.35 + i * 0.08) + i * 0.4) % 1;
      var r = base * (0.55 + expand * (1.4 + i * 0.35));
      var a = alpha * (0.35 + v * 0.45 + p * 0.35) * (1 - expand) * (1 - i * 0.12);
      if (a < 0.01) continue;
      ctx2.strokeStyle = 'rgba(255,186,110,' + a.toFixed(3) + ')';
      ctx2.lineWidth = 1.6 + p * 2.2;
      ctx2.beginPath();
      ctx2.arc(dx, dy, r, 0, TAU);
      ctx2.stroke();
    }
    // core glow
    var cg = ctx2.createRadialGradient(dx, dy, 2, dx, dy, 28 + v * 40);
    cg.addColorStop(0, 'rgba(255,200,120,' + (0.45 * alpha * (0.4 + v)).toFixed(3) + ')');
    cg.addColorStop(1, 'rgba(255,180,90,0)');
    ctx2.fillStyle = cg;
    ctx2.beginPath();
    ctx2.arc(dx, dy, 28 + v * 40, 0, TAU);
    ctx2.fill();
    ctx2.restore();
  }

  function drawWaves(ctx2, shot, t, alpha) {
    if (alpha <= 0.01) return;
    var horizon = shot.id === 4 ? 0.62 : 0.68;
    var y0 = horizon * H;
    ctx2.save();
    ctx2.globalAlpha = 0.35 * alpha;
    for (var k = 0; k < 5; k++) {
      var amp = 6 + k * 3;
      var y = y0 + k * 18 + Math.sin(t * (0.6 + k * 0.15) + k) * 4;
      ctx2.strokeStyle = 'rgba(220,230,255,' + (0.18 + k * 0.04).toFixed(3) + ')';
      ctx2.lineWidth = 1.2;
      ctx2.beginPath();
      for (var x = 0; x <= W; x += 8) {
        var yy = y + Math.sin(x * 0.008 + t * (1.1 + k * 0.2) + k) * amp
                  + Math.sin(x * 0.021 - t * 0.7) * (amp * 0.35);
        if (x === 0) ctx2.moveTo(x, yy); else ctx2.lineTo(x, yy);
      }
      ctx2.stroke();
    }
    // moonlight path on water
    var mx = shot.moon[0] * W;
    var g = ctx2.createLinearGradient(mx, y0, mx, H);
    g.addColorStop(0, 'rgba(255,235,190,' + (0.18 * alpha).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,235,190,0)');
    ctx2.fillStyle = g;
    ctx2.beginPath();
    ctx2.moveTo(mx - 40, y0);
    for (var x2 = mx - 70; x2 <= mx + 70; x2 += 6) {
      var spread = ((x2 - mx) / 70);
      var yy2 = y0 + (H - y0) * Math.abs(spread) * 0.15
        + Math.sin(x2 * 0.05 + t * 2) * 3;
      // build ribbon
    }
    ctx2.globalAlpha = 0.22 * alpha;
    ctx2.beginPath();
    ctx2.moveTo(mx - 20, y0);
    ctx2.quadraticCurveTo(mx - 55, lerp(y0, H, 0.55), mx - 90, H);
    ctx2.lineTo(mx + 90, H);
    ctx2.quadraticCurveTo(mx + 55, lerp(y0, H, 0.55), mx + 20, y0);
    ctx2.closePath();
    ctx2.fillStyle = 'rgba(255,230,180,0.35)';
    ctx2.fill();
    ctx2.restore();
  }

  function drawCityTrails(ctx2, t, alpha) {
    if (alpha <= 0.01) return;
    ctx2.save();
    for (var i = 0; i < TRAILS.length; i++) {
      var tr = TRAILS[i];
      var x = ((tr.x + t * tr.sp * (tr.warm ? 1 : -0.6)) % 1 + 1) % 1;
      var y = tr.y * H + Math.sin(t * 0.5 + tr.ph * 10) * 3;
      var len = tr.len * W;
      var grad = ctx2.createLinearGradient(x * W - len, y, x * W + len * 0.2, y);
      if (tr.warm) {
        grad.addColorStop(0, 'rgba(255,140,90,0)');
        grad.addColorStop(0.7, 'rgba(255,170,110,' + (0.35 * alpha).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(255,220,180,' + (0.55 * alpha).toFixed(3) + ')');
      } else {
        grad.addColorStop(0, 'rgba(180,200,255,0)');
        grad.addColorStop(1, 'rgba(200,220,255,' + (0.4 * alpha).toFixed(3) + ')');
      }
      ctx2.strokeStyle = grad;
      ctx2.lineWidth = 1.4 + (tr.warm ? 0.8 : 0);
      ctx2.beginPath();
      ctx2.moveTo(x * W - len, y);
      ctx2.lineTo(x * W, y);
      ctx2.stroke();
    }
    ctx2.restore();
  }

  function drawCurtainSway(ctx2, shot, t, alpha) {
    if (alpha <= 0.01) return;
    var pause = (t >= 18.60 && t <= 19.35);
    var sway = pause ? 0 : Math.sin(t * 0.85) * 14;
    ctx2.save();
    ctx2.globalAlpha = 0.12 * alpha;
    var g = ctx2.createLinearGradient(0, 0, 160 + sway, 0);
    g.addColorStop(0, 'rgba(255,248,240,0.55)');
    g.addColorStop(0.6, 'rgba(255,248,240,0.08)');
    g.addColorStop(1, 'rgba(255,248,240,0)');
    ctx2.fillStyle = g;
    ctx2.beginPath();
    ctx2.moveTo(0, 0);
    ctx2.bezierCurveTo(40 + sway, H * 0.25, 20 + sway * 0.6, H * 0.55, 50 + sway, H);
    ctx2.lineTo(0, H);
    ctx2.closePath();
    ctx2.fill();
    ctx2.restore();
  }

  function drawFilmGrain(ctx2, t) {
    // Lightweight procedural grain (not per-pixel — sparse speckles + soft vignette)
    var rd = mulberry32((Math.floor(t * 60) * 2654435761) >>> 0);
    ctx2.save();
    ctx2.globalAlpha = 0.045;
    for (var i = 0; i < 320; i++) {
      var x = rd() * W, y = rd() * H;
      var v = rd() > 0.5 ? 255 : 0;
      ctx2.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      ctx2.fillRect(x, y, 1.2, 1.2);
    }
    ctx2.globalAlpha = 1;
    var vig = ctx2.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(8,6,12,0.28)');
    ctx2.fillStyle = vig;
    ctx2.fillRect(0, 0, W, H);
    ctx2.restore();
  }

  function drawBlinkHint(ctx2, shot, t, alpha) {
    // Soft periodic darkening near upper-character region (approximate "alive" blink)
    if (!hasTag(shot, 'breathe') && !hasTag(shot, 'desk') && shot.id !== 5) return;
    var cycle = (t % 4.2);
    if (cycle < 3.75) return;
    var u = (cycle - 3.75) / 0.45;
    var a = Math.sin(u * Math.PI) * 0.08 * alpha;
    if (a < 0.005) return;
    var cx = shot.device[0] * W - 80;
    var cy = shot.device[1] * H - 120;
    ctx2.fillStyle = 'rgba(20,12,18,' + a.toFixed(3) + ')';
    ctx2.beginPath();
    ctx2.ellipse(cx, cy, 50, 18, 0, 0, TAU);
    ctx2.fill();
  }

  /* ---------- compose one shot ---------- */
  function drawShotLayers(ctx2, shot, t, alpha) {
    if (alpha <= 0.01) return;
    ctx2.save();
    ctx2.globalAlpha = alpha;
    var motion = plateMotion(shot, t);
    var img = images[shot.id];
    coverDraw(ctx2, img, 0, 0, W, H, motion.px, motion.py, motion.scale);

    if (hasTag(shot, 'curtain') || hasTag(shot, 'indoor')) drawCurtainSway(ctx2, shot, t, 1);
    if (hasTag(shot, 'stars') || hasTag(shot, 'halo') || hasTag(shot, 'shore') || hasTag(shot, 'rooftop') || shot.id === 3) {
      drawStars(ctx2, t, hasTag(shot, 'stars') || hasTag(shot, 'shore') || hasTag(shot, 'rooftop') ? 0.85 : 0.35);
    }
    if (hasTag(shot, 'halo') || shot.id >= 4) drawMoonHalo(ctx2, shot, t, shot.id >= 4 ? 1 : 0.55);
    else if (shot.id === 2 || shot.id === 3) drawMoonHalo(ctx2, shot, t, 0.45);

    if (hasTag(shot, 'waves')) drawWaves(ctx2, shot, t, 1);
    if (hasTag(shot, 'trails') || hasTag(shot, 'city')) drawCityTrails(ctx2, t, 0.9);
    if (hasTag(shot, 'dust') || hasTag(shot, 'indoor')) drawDust(ctx2, t, 0.9, motion.pause);

    drawDeviceRings(ctx2, shot, t, 1);
    drawBlinkHint(ctx2, shot, t, 1);

    // Subtle head sway shadow shift for character shots
    if (hasTag(shot, 'breathe') || hasTag(shot, 'desk') || shot.id === 5 || shot.id === 7) {
      var sway = motion.pause ? 0 : Math.sin(t * 0.55) * 6;
      ctx2.globalAlpha = alpha * 0.04;
      ctx2.fillStyle = '#000';
      ctx2.beginPath();
      ctx2.ellipse(shot.device[0] * W - 100 + sway, shot.device[1] * H - 80, 90, 120, sway * 0.02, 0, TAU);
      ctx2.fill();
    }
    ctx2.restore();
  }

  function shapeMatchCenter(fromShot, toShot, u) {
    // Prefer moon match when both night/outdoor; else blend moon+device
    var useMoon = (fromShot.id >= 3 && toShot.id >= 3) || (fromShot.id === 2 && toShot.id === 3) ||
                  (fromShot.id === 5 && toShot.id === 6) || (fromShot.id === 6 && toShot.id === 7);
    var useDevice = (fromShot.id <= 2 && toShot.id <= 2) || (fromShot.id === 1);
    var a, b;
    if (useDevice && !useMoon) {
      a = fromShot.device; b = toShot.device;
    } else if (fromShot.id === 2 && toShot.id === 3) {
      // reflection match: device glow -> moon
      a = fromShot.device; b = toShot.moon;
    } else {
      a = fromShot.moon; b = toShot.moon;
    }
    return [lerp(a[0], b[0], u) * W, lerp(a[1], b[1], u) * H];
  }

  function drawTransition(ctx2, t, tr) {
    var A = SHOTS[tr.from], B = SHOTS[tr.to];
    var u = tr.u;
    var center = shapeMatchCenter(A, B, u);
    var maxR = Math.sqrt(W * W + H * H) * 0.72;
    var radius = smoother(u) * maxR;

    // Draw outgoing full
    drawShotLayers(ctx2, A, t, 1);

    // Iris reveal incoming
    ctx2.save();
    ctx2.beginPath();
    ctx2.arc(center[0], center[1], Math.max(0.5, radius), 0, TAU);
    ctx2.clip();
    drawShotLayers(ctx2, B, t, 1);
    ctx2.restore();

    // Soft ring at iris edge (shape-match accent)
    if (u > 0.02 && u < 0.98) {
      var ringA = Math.sin(u * Math.PI) * 0.55;
      ctx2.save();
      ctx2.strokeStyle = 'rgba(255,210,150,' + (ringA * 0.55).toFixed(3) + ')';
      ctx2.lineWidth = 3;
      ctx2.beginPath();
      ctx2.arc(center[0], center[1], radius, 0, TAU);
      ctx2.stroke();
      ctx2.strokeStyle = 'rgba(255,240,210,' + (ringA * 0.25).toFixed(3) + ')';
      ctx2.lineWidth = 10;
      ctx2.beginPath();
      ctx2.arc(center[0], center[1], radius, 0, TAU);
      ctx2.stroke();
      ctx2.restore();
    }
  }

  /* ---------- lyrics / title ---------- */
  function activeLine(t) {
    var lines = LYRICS.lines || [];
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (t >= L.start - 0.05 && t <= L.end + 0.35) return L;
    }
    return null;
  }

  function drawTitle(ctx2, t) {
    if (t < 2.5 || t > 12.5) return;
    var fadeIn = smoother(clamp((t - 2.5) / 1.2, 0, 1));
    var fadeOut = 1 - smoother(clamp((t - 11.2) / 1.3, 0, 1));
    var a = fadeIn * fadeOut;
    if (a < 0.01) return;
    ctx2.save();
    ctx2.globalAlpha = a * 0.92;
    ctx2.fillStyle = 'rgba(255,244,230,0.92)';
    ctx2.font = '300 42px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx2.textAlign = 'left';
    ctx2.shadowColor = 'rgba(0,0,0,0.45)';
    ctx2.shadowBlur = 12;
    ctx2.fillText('The Moon Song', W * 0.08, H * 0.18);
    ctx2.font = '300 22px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    ctx2.fillStyle = 'rgba(255,230,200,0.75)';
    ctx2.fillText('from Her (2013)', W * 0.08, H * 0.18 + 36);
    ctx2.restore();
  }

  function drawLyrics(ctx2, t) {
    if (state.subtitleMode === 'off') return;
    var line = activeLine(t);
    if (!line) return;
    var fadeIn = smoother(clamp((t - line.start) / 0.35, 0, 1));
    var fadeOut = 1 - smoother(clamp((t - line.end) / 0.35, 0, 1));
    var a = fadeIn * fadeOut;
    if (a < 0.01) return;

    ctx2.save();
    ctx2.textAlign = 'center';
    ctx2.shadowColor = 'rgba(0,0,0,0.65)';
    ctx2.shadowBlur = 10;

    var yEn = H * 0.86;
    var yZh = H * 0.86 + 40;
    var showZh = state.subtitleMode === 'both';

    // English with optional word glow
    if (state.subtitleMode === 'en' || state.subtitleMode === 'both') {
      var words = line.words || [];
      if (state.wordGlow && words.length) {
        // measure total
        ctx2.font = '400 36px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
        var parts = [];
        var totalW = 0;
        for (var i = 0; i < words.length; i++) {
          var w = words[i].word + (i < words.length - 1 ? ' ' : '');
          var ww = ctx2.measureText(w).width;
          parts.push({ text: w, width: ww, word: words[i] });
          totalW += ww;
        }
        var x0 = W / 2 - totalW / 2;
        var x = x0;
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j];
          var active = t >= p.word.start && t <= p.word.end;
          var warm = active ? 1 : clamp(1 - Math.min(Math.abs(t - p.word.start), Math.abs(t - p.word.end)) / 0.6, 0, 1) * 0.35;
          var glow = active ? 1 : warm;
          ctx2.globalAlpha = a * (0.55 + glow * 0.45);
          ctx2.fillStyle = active ? 'rgba(255,220,160,1)' : 'rgba(255,245,230,0.92)';
          if (active) {
            ctx2.shadowColor = 'rgba(255,180,100,0.85)';
            ctx2.shadowBlur = 18;
          } else {
            ctx2.shadowColor = 'rgba(0,0,0,0.65)';
            ctx2.shadowBlur = 10;
          }
          ctx2.textAlign = 'left';
          ctx2.fillText(p.text, x, yEn);
          x += p.width;
        }
      } else {
        ctx2.globalAlpha = a;
        ctx2.fillStyle = 'rgba(255,245,230,0.95)';
        ctx2.font = '400 36px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
        ctx2.fillText(line.en, W / 2, yEn);
      }
    }

    if (showZh && line.zh) {
      ctx2.textAlign = 'center';
      ctx2.globalAlpha = a * 0.85;
      ctx2.shadowColor = 'rgba(0,0,0,0.65)';
      ctx2.shadowBlur = 8;
      ctx2.fillStyle = 'rgba(255,230,210,0.88)';
      ctx2.font = '400 24px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
      ctx2.fillText(line.zh, W / 2, state.subtitleMode === 'both' ? yZh : yEn);
    }
    ctx2.restore();
  }

  /* ---------- main render ---------- */
  function renderAt(t) {
    if (!canvas) return;
    // Re-acquire context every frame — assigning canvas.width/height resets it.
    ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;
    t = clamp(+t || 0, 0, DURATION);
    state.lastT = t;

    var dpr = canvas._dpr || 1;
    // Ensure backing store matches logical stage * dpr
    var bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#0c0a10';
    ctx.fillRect(0, 0, W, H);

    var tr = transitionInfo(t);
    if (tr) {
      drawTransition(ctx, t, tr);
    } else {
      var si = shotIndexAt(t);
      drawShotLayers(ctx, SHOTS[si], t, 1);
    }

    drawTitle(ctx, t);
    drawLyrics(ctx, t);
    drawFilmGrain(ctx, t);

    // End fade
    if (t > DURATION - 1.2) {
      var ea = smoother((t - (DURATION - 1.2)) / 1.2);
      ctx.fillStyle = 'rgba(8,6,12,' + ea.toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }
  window.renderAt = renderAt;

  function seekTo(t) {
    t = clamp(+t || 0, 0, DURATION);
    seekGuardUntil = performance.now() + 250;
    renderAt(t); // render immediately at requested time (do not wait for audio seek)
    if (audio) {
      try { audio.currentTime = t; } catch (e) {}
    }
    syncUI();
  }
  window.seekTo = seekTo;

  /* ---------- layout / UI ---------- */
  function resize() {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas._dpr = dpr;
    // Internal resolution always logical W×H * dpr for crispness
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // Cover-scale to viewport via CSS
    var vw = window.innerWidth, vh = window.innerHeight;
    var scale = Math.max(vw / W, vh / H);
    var cw = W * scale, ch = H * scale;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.style.left = ((vw - cw) / 2) + 'px';
    canvas.style.top = ((vh - ch) / 2) + 'px';
    renderAt(state.lastT || (audio ? audio.currentTime : 0));
  }

  function fmtTime(t) {
    t = Math.max(0, t || 0);
    var m = Math.floor(t / 60);
    var s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function syncUI() {
    if (!ui) return;
    var t = audio && isFinite(audio.currentTime) ? audio.currentTime : state.lastT;
    var playBtn = ui.querySelector('[data-act=play]');
    if (playBtn) playBtn.textContent = (!audio || audio.paused) ? '▶' : '❚❚';
    var scrub = ui.querySelector('[data-act=scrub]');
    if (scrub && !state.pointerActive) {
      scrub.value = String((t / DURATION) * 1000);
    }
    var timeEl = ui.querySelector('[data-act=time]');
    if (timeEl) timeEl.textContent = fmtTime(t) + ' / ' + fmtTime(DURATION);
    var subBtn = ui.querySelector('[data-act=subs]');
    if (subBtn) {
      subBtn.textContent = state.subtitleMode === 'both' ? 'EN+ZH' :
        state.subtitleMode === 'en' ? 'EN' : 'Off';
    }
  }

  function pokeUI() {
    if (!ui) return;
    ui.classList.remove('hidden');
    state.hideUI = false;
    clearTimeout(state.uiTimer);
    state.uiTimer = setTimeout(function () {
      if (audio && !audio.paused) {
        ui.classList.add('hidden');
        state.hideUI = true;
      }
    }, 2800);
  }

  function buildUI() {
    ui = document.getElementById('mv-ui');
    if (!ui) {
      ui = document.createElement('div');
      ui.id = 'mv-ui';
      document.body.appendChild(ui);
    }
    var markers = SHOTS.map(function (s) {
      var pct = (s.start / DURATION) * 100;
      return '<i class="marker" style="left:' + pct + '%" title="Shot ' + s.id + '" data-t="' + s.start + '"></i>';
    }).join('');
    ui.innerHTML =
      '<div class="bar">' +
      '<button type="button" data-act="play" title="Play/Pause">▶</button>' +
      '<div class="scrub-wrap">' +
      '<input type="range" data-act="scrub" min="0" max="1000" value="0" step="1"/>' +
      '<div class="markers">' + markers + '</div>' +
      '</div>' +
      '<span class="time" data-act="time">0:00 / 1:49</span>' +
      '<input type="range" data-act="vol" min="0" max="100" value="90" title="Volume"/>' +
      '<button type="button" data-act="subs" title="Subtitles">EN+ZH</button>' +
      '<button type="button" data-act="glow" title="Word glow">Glow</button>' +
      '<button type="button" data-act="fs" title="Fullscreen">⛶</button>' +
      '</div>';

    ui.querySelector('[data-act=play]').addEventListener('click', togglePlay);
    var scrub = ui.querySelector('[data-act=scrub]');
    scrub.addEventListener('pointerdown', function () { state.pointerActive = true; });
    scrub.addEventListener('pointerup', function () { state.pointerActive = false; });
    scrub.addEventListener('input', function () {
      var t = (scrub.value / 1000) * DURATION;
      seekTo(t);
      pokeUI();
    });
    ui.querySelector('[data-act=vol]').addEventListener('input', function (e) {
      state.volume = e.target.value / 100;
      if (audio) audio.volume = state.volume;
    });
    ui.querySelector('[data-act=subs]').addEventListener('click', function () {
      state.subtitleMode = state.subtitleMode === 'both' ? 'en' :
        state.subtitleMode === 'en' ? 'off' : 'both';
      syncUI();
      renderAt(state.lastT);
      pokeUI();
    });
    ui.querySelector('[data-act=glow]').addEventListener('click', function () {
      state.wordGlow = !state.wordGlow;
      this.classList.toggle('off', !state.wordGlow);
      renderAt(state.lastT);
      pokeUI();
    });
    ui.querySelector('[data-act=fs]').addEventListener('click', function () {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
      else document.exitFullscreen().catch(function () {});
      pokeUI();
    });
    ui.querySelectorAll('.marker').forEach(function (m) {
      m.addEventListener('click', function () {
        seekTo(parseFloat(m.getAttribute('data-t')));
        pokeUI();
      });
    });
  }

  function togglePlay() {
    if (!audio) return;
    if (audio.paused) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      audio.pause();
    }
    syncUI();
    pokeUI();
  }

  var raf = 0;
  var seekGuardUntil = 0; // ignore stale audio.currentTime briefly after seekTo
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!audio) return;
    // While playing, clock is audio.currentTime.
    // While paused, only re-render from audio after a completed seek (seeked handler),
    // never overwrite an explicit renderAt/seekTo with a stale currentTime.
    if (!audio.paused) {
      if (performance.now() < seekGuardUntil) return;
      renderAt(audio.currentTime || 0);
      syncUI();
    }
  }

  function onKey(e) {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo((audio ? audio.currentTime : state.lastT) - (e.shiftKey ? 1 : 5)); pokeUI(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo((audio ? audio.currentTime : state.lastT) + (e.shiftKey ? 1 : 5)); pokeUI(); }
    else if (e.key === 'f' || e.key === 'F') { ui.querySelector('[data-act=fs]').click(); }
    else if (e.key === 's' || e.key === 'S') { ui.querySelector('[data-act=subs]').click(); }
    pokeUI();
  }

  function init() {
    canvas = document.getElementById('stage');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'stage';
      document.body.appendChild(canvas);
    }
    ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    audio = document.getElementById('audio');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'audio';
      audio.preload = 'auto';
      audio.innerHTML =
        '<source src="assets/moon-song.m4a" type="audio/mp4">' +
        '<source src="assets/moon-song.wav" type="audio/wav">' +
        '<source src="assets/moon-song.mp3" type="audio/mpeg">' +
        '<source src="assets/moon-song.aac" type="audio/aac">';
      document.body.appendChild(audio);
    }
    audio.volume = state.volume;
    // 0ms offset — primary clock is audio.currentTime
    audio.addEventListener('play', function () { state.playing = true; syncUI(); pokeUI(); });
    audio.addEventListener('pause', function () { state.playing = false; syncUI(); pokeUI(); });
    audio.addEventListener('ended', function () {
      state.playing = false;
      renderAt(DURATION);
      syncUI();
    });
    audio.addEventListener('loadedmetadata', function () { syncUI(); });
    audio.addEventListener('seeked', function () {
      seekGuardUntil = 0;
      if (audio.paused) {
        renderAt(audio.currentTime || 0);
        syncUI();
      }
    });

    buildUI();
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousemove', pokeUI);
    document.addEventListener('pointerdown', pokeUI);
    canvas.addEventListener('click', function () { togglePlay(); });

    loadImages(function () {
      state.ready = true;
      renderAt(audio && isFinite(audio.currentTime) ? audio.currentTime : 0);
      syncUI();
      document.documentElement.classList.add('ready');
    });
    loop();

    // Expose for QA / export
    window.__moonMV = {
      W: W, H: H, DURATION: DURATION, SHOTS: SHOTS,
      state: state, audio: audio, canvas: canvas,
      renderAt: renderAt, seekTo: seekTo,
      vocalEnvelope: vocalEnvelope, pluckEnvelope: pluckEnvelope,
      shotIndexAt: shotIndexAt
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
