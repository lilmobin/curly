/* ==========================================================================
   fx.js — the atmosphere
   One <canvas> draws everything that is "light":
     • layered dusty-rose haze + slow nebula wisps
     • micro dust, glitter, four-point star sparkles, sparkles riding the trails
     • thin silk-like light trails
     • the lily that is assembled from light while loading
   main.js owns the timeline and hands this file a `params` object every frame.
   ========================================================================== */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- math */
  function clamp(v, a, b) { if (a === undefined) a = 0; if (b === undefined) b = 1; return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  function easeOutCubic(t) { t = clamp(t); return 1 - Math.pow(1 - t, 3); }
  function easeOutExpo(t) { t = clamp(t); return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeInOutCubic(t) { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function seeded(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  /* colour ramp for light: deep crimson (h = 0) → the original warm white (h = 1) */
  var RED = [214, 24, 50], PALE = [255, 236, 242];
  function tint(base, h) {
    var c = makeCanvas(base.width, base.height), x = c.getContext('2d');
    x.drawImage(base, 0, 0);
    x.globalCompositeOperation = 'source-atop'; x.globalAlpha = 1 - h;
    x.fillStyle = 'rgb(' + Math.round(RED[0] + (PALE[0] - RED[0]) * h) + ',' + Math.round(RED[1] + (PALE[1] - RED[1]) * h) + ',' + Math.round(RED[2] + (PALE[2] - RED[2]) * h) + ')';
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function hIdx(h) { return Math.round(clamp(h) * 4); }

  /* ----------------------------------------------------- petal geometry
     Everything is built once in "unit space": base at (0,0), tip at (0,-1). */
  function polyLen(pts) {
    var l = 0;
    for (var i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return l;
  }
  function curveThrough(path, pts, first) {
    if (first) path.moveTo(pts[0][0], pts[0][1]); else path.lineTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {
      path.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    var l = pts[pts.length - 1];
    path.lineTo(l[0], l[1]);
  }
  function buildPetalShape(def) {
    var N = 24, w = def.w, bend = def.bend || 0, curl = def.curl || 0;
    var left = [], right = [], mid = [], hw = [], i, t, h, c;
    for (i = 0; i <= N; i++) {
      t = i / N;
      h = w * Math.pow(t, .6) * Math.pow(1 - t, .9) / .364;      // half-width profile: narrow base, widest ~40 %, pointed tip
      c = bend * t * t - curl * Math.pow(t, 5);                    // centre line (outward bend + tiny recurve)
      left.push([c - h, -t]); right.push([c + h, -t]); mid.push([c, -t]); hw.push(h);
    }
    var fill = new Path2D(), pl = new Path2D(), pr = new Path2D(), rib = new Path2D(), vl = new Path2D(), vr = new Path2D();
    curveThrough(fill, left, true); curveThrough(fill, right.slice().reverse(), false); fill.closePath();
    curveThrough(pl, left, true); curveThrough(pr, right, true);
    var ribPts = [], vlPts = [], vrPts = [];
    for (i = 1; i <= N - 3; i++) {
      ribPts.push(mid[i]);
      if (i >= 3 && i <= N - 6) { vlPts.push([mid[i][0] - hw[i] * .48, mid[i][1]]); vrPts.push([mid[i][0] + hw[i] * .48, mid[i][1]]); }
    }
    curveThrough(rib, ribPts, true); curveThrough(vl, vlPts, true); curveThrough(vr, vrPts, true);
    return {
      N: N, mid: mid, hw: hw, fill: fill, left: pl, right: pr, rib: rib, vl: vl, vr: vr,
      len: polyLen(left), vlen: polyLen(ribPts)
    };
  }

  /* Seven petals, ordered the way they open (see start / dur, both in loading-progress units 0–1).
     a = fan angle (rad), k = length factor, w = half-width, layer 0 = behind, 1 = in front. */
  var PETAL_DEFS = [
    { a:  0.00, k:  .94, w: .22, bend:  0,   curl:  .02, s: .35, d: .24, layer: 1, am: 1.00, ord: 3 },  // 1  centre front, rises first
    { a: -0.44, k:  .90, w: .21, bend: -.10, curl: -.03, s: .40, d: .25, layer: 1, am:  .95, ord: 2 },  // 2  curves left
    { a:  0.44, k:  .90, w: .21, bend:  .10, curl:  .03, s: .44, d: .25, layer: 1, am:  .95, ord: 2 },  // 3  curves right
    { a:  0.00, k: 1.06, w: .18, bend:  0,   curl:  0,   s: .50, d: .26, layer: 0, am:  .72, ord: 1 },  // 4  behind, tall
    { a: -0.90, k:  .82, w: .20, bend: -.16, curl: -.05, s: .58, d: .26, layer: 0, am:  .85, ord: 0 },  // 5  opens outward, left
    { a:  0.90, k:  .82, w: .20, bend:  .16, curl:  .05, s: .62, d: .26, layer: 0, am:  .85, ord: 0 },  // 6  opens outward, right
    { a: -1.30, k:  .78, w: .19, bend: -.20, curl: -.06, s: .60, d: .26, layer: 0, am:  .70, ord: 0 },  // 7  wide, low, left  (reference lotus spreads wide)
    { a:  1.30, k:  .78, w: .19, bend:  .20, curl:  .06, s: .64, d: .26, layer: 0, am:  .70, ord: 0 },  // 8  wide, low, right
    { a:  0.00, k:  .60, w: .15, bend:  0,   curl:  0,   s: .74, d: .20, layer: 1, am: 1.15, ord: 4 }   // 9  small inner bud, opens upward
  ];

  /* ------------------------------------------------------------- trails */
  var TRAIL_DEFS = [
    { id: 'A',  t0: 1.0, t1: 3.3, kind: 'spline', amp: 1.0, pts: [[-.10, .30], [.12, .21], [.38, .165], [.66, .19], [.92, .26], [1.12, .33]] },
    { id: 'B',  t0: 1.5, t1: 4.0, kind: 'spline', amp: .8,  pts: [[-.10, .60], [.16, .68], [.46, .64], [.76, .72], [1.10, .82]] },
    { id: 'C',  t0: 2.2, t1: 4.4, kind: 'ring',   amp: .6 },
    { id: 'D',  t0: 2.8, t1: 5.2, kind: 'spline', amp: .5,  pts: [[-.10, .90], [.25, .84], [.58, .90], [1.10, .95]] },
    /* extra hair-thin strands that flow alongside the main ribbons */
    { id: 'A2', t0: 1.3, t1: 3.6, kind: 'spline', amp: .6,  thin: true, spk: 6, pts: [[-.10, .318], [.12, .232], [.38, .186], [.66, .212], [.92, .282], [1.12, .352]] },
    { id: 'F',  t0: 2.0, t1: 4.4, kind: 'spline', amp: .8,  thin: true, spk: 8, pts: [[1.10, .14], [.88, .24], [.60, .34], [.28, .40], [.04, .50], [-.10, .58]] },
    { id: 'B2', t0: 1.8, t1: 4.2, kind: 'spline', amp: .55, thin: true, spk: 6, pts: [[-.10, .628], [.16, .706], [.46, .668], [.76, .750], [1.10, .855]] },
    { id: 'G',  t0: 3.0, t1: 5.2, kind: 'spline', amp: .65, thin: true, spk: 8, pts: [[1.10, .66], [.82, .76], [.52, .83], [.30, .92], [.05, .985]] }
  ];
  var SPS = 22;            // spline samples per segment
  var RING_N = 120;

  function catmull(pts, out) {
    var n = pts.length, k = 0, i, s, p0, p1, p2, p3, t, t2, t3;
    for (i = 0; i < n - 1; i++) {
      p0 = pts[Math.max(i - 1, 0)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[Math.min(i + 2, n - 1)];
      for (s = 0; s < SPS; s++) {
        t = s / SPS; t2 = t * t; t3 = t2 * t;
        out[k++] = .5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        out[k++] = .5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      }
    }
    out[k++] = pts[n - 1][0]; out[k++] = pts[n - 1][1];
    return k / 2;
  }
  function trailEnv(s) { return Math.pow(Math.sin(Math.PI * clamp(s)), .6); }

  /* ==================================================================== */
  function createFX(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d', { alpha: false });
    var W = 0, H = 0, dpr = 1, S = 390;
    var maxDPR = opts.maxDPR || 2;
    var quality = 1, motion = 1, reduced = !!opts.reduced;
    var time = 0;
    var info = { S: 390, flower: { bx: 0, by: 0, L: 120 }, title: { cx: 0, cy: 0, w: 300, h: 130 }, center: { x: 0, y: 0, rx: 150, ry: 150 } };
    var par = { x: 0, y: 0, tx: 0, ty: 0 };
    var haze = null, hazeW = 0, hazeH = 0, wisps = null, wisps2 = null, wispW = 0, wispH = 0;
    var spr = {};
    var prevTitleDiss = 0, prevFlowerDiss = 0;
    var acc = { star: 0, assemble: 0, out: 0, orb: 0 };
    var slow = 0, started = false, bW = 1, bH = 1, lastBuildMs = 0;

    /* ---------------------------------------------------------- sprites */
    function sprite(size, fn) { var c = makeCanvas(size, size); fn(c.getContext('2d'), size); return c; }
    function buildSprites() {
      spr.dot = sprite(64, function (c) {                    // soft glowing dot
        var g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,252,252,1)'); g.addColorStop(.14, 'rgba(255,241,245,.95)');
        g.addColorStop(.32, 'rgba(255,205,220,.34)'); g.addColorStop(.6, 'rgba(255,182,206,.08)'); g.addColorStop(1, 'rgba(255,182,206,0)');
        c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      });
      spr.pin = sprite(32, function (c) {                    // crisp dust speck
        var g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, 'rgba(255,250,251,1)'); g.addColorStop(.34, 'rgba(255,240,245,.9)');
        g.addColorStop(.62, 'rgba(255,214,228,.22)'); g.addColorStop(1, 'rgba(255,214,228,0)');
        c.fillStyle = g; c.fillRect(0, 0, 32, 32);
      });
      spr.star = sprite(192, function (c, s) {               // four-point sparkle
        var m = s / 2, g = c.createRadialGradient(m, m, 0, m, m, m * .5);
        c.globalCompositeOperation = 'lighter';
        g.addColorStop(0, 'rgba(255,250,251,.95)'); g.addColorStop(.16, 'rgba(255,228,238,.62)'); g.addColorStop(.42, 'rgba(255,168,194,.2)'); g.addColorStop(1, 'rgba(255,150,180,0)');
        c.fillStyle = g; c.fillRect(0, 0, s, s);
        function spike(len, wid, alpha, rot) {
          c.save(); c.translate(m, m); c.rotate(rot);
          var lg = c.createLinearGradient(0, -len, 0, len);
          lg.addColorStop(0, 'rgba(255,240,246,0)'); lg.addColorStop(.5, 'rgba(255,248,250,' + alpha + ')'); lg.addColorStop(1, 'rgba(255,240,246,0)');
          c.fillStyle = lg; c.beginPath(); c.moveTo(0, -len);
          c.quadraticCurveTo(wid, 0, 0, len); c.quadraticCurveTo(-wid, 0, 0, -len); c.fill(); c.restore();
        }
        spike(m * .98, m * .055, 1, 0); spike(m * .98, m * .055, 1, Math.PI / 2);
        spike(m * .42, m * .035, .5, Math.PI / 4); spike(m * .42, m * .035, .5, -Math.PI / 4);
      });
      spr.dotT = []; spr.pinT = []; spr.starT = [];
      for (var hh = 0; hh <= 4; hh++) {
        spr.dotT.push(hh === 4 ? spr.dot : tint(spr.dot, hh / 4));
        spr.pinT.push(hh === 4 ? spr.pin : tint(spr.pin, hh / 4));
        spr.starT.push(hh === 4 ? spr.star : tint(spr.star, hh / 4));
      }
    }

    /* ------------------------------------------------- haze / wisps (pre-rendered) */
    function buildHaze() {
      var sc = .5, ow = Math.ceil(W * 1.3), oh = Math.ceil(H * 1.3);
      var cw = Math.max(64, Math.round(ow * sc)), ch = Math.max(64, Math.round(oh * sc));
      haze = makeCanvas(cw, ch);
      var c = haze.getContext('2d'), rng = seeded(11), i;
      /* vertical profile measured from the reference's final frames (screen fraction → colour);
         the canvas is 30 % oversize so fractions are remapped */
      var stops = [[0, '151,71,83'], [.18, '150,70,82'], [.33, '165,77,91'], [.55, '177,85,99'], [.72, '187,91,104'], [.88, '191,93,106'], [1, '180,87,100']];
      var g = c.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, 'rgb(' + stops[0][1] + ')');
      for (i = 0; i < stops.length; i++) g.addColorStop(clamp((stops[i][0] + .15) / 1.3), 'rgb(' + stops[i][1] + ')');
      g.addColorStop(1, 'rgb(' + stops[stops.length - 1][1] + ')');
      c.fillStyle = g; c.fillRect(0, 0, cw, ch);
      /* faint cloudiness only — the reference is a smooth, deep field, not a textured sheet */
      var R = Math.max(cw, ch);
      for (i = 0; i < 12; i++) {
        var x = rng() * cw, y = rng() * ch, r = R * (.25 + rng() * .4), k = rng();
        var col = k < .5 ? '206,112,130' : '112,44,62', a = k < .5 ? .05 : .06;
        var rg = c.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, 'rgba(' + col + ',' + a + ')'); rg.addColorStop(1, 'rgba(' + col + ',0)');
        c.fillStyle = rg; c.fillRect(0, 0, cw, ch);
      }
      hazeW = ow; hazeH = oh;
    }
    /* Nebula: domain-warped noise → long flowing luminous streaks with fine dust inside them,
       like the cloud ribbons in the reference. Generated once per size, then only drifted. */
    var NT = null;
    function initNoise() { var r = seeded(5), i; NT = new Float32Array(65536); for (i = 0; i < 65536; i++) NT[i] = r(); }
    function vnoise(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
      var a = NT[x0 | y0], b = NT[x1 | y0], c = NT[x0 | y1], d = NT[x1 | y1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function fbm(x, y) {
      return (vnoise(x, y) * .5 + vnoise(x * 2.03 + 7.1, y * 2.03 + 3.7) * .25 + vnoise(x * 4.1 + 1.9, y * 4.1 + 9.2) * .125 + vnoise(x * 8.3 + 4.4, y * 8.3 + 2.6) * .0625) / .9375;
    }
    function makeNebula(ow, oh, o) {
      var sc = clamp(1100 / Math.max(ow, oh), .5, 1), cw = Math.round(ow * sc), ch = Math.round(oh * sc);
      var gw = 150, gh = Math.max(40, Math.round(gw * oh / ow));
      var map = new Float32Array(gw * gh), c0 = makeCanvas(gw, gh), x0 = c0.getContext('2d'), img = x0.createImageData(gw, gh), d = img.data;
      var i, j, u, v, q1, q2, band, cloud, env, val, k;
      for (j = 0; j < gh; j++) for (i = 0; i < gw; i++) {
        u = i / gw; v = j / gh;
        q1 = fbm(u * o.f + o.sx, v * o.f * 1.6 + o.sy);
        q2 = fbm(u * o.f + 5.2 + o.sx, v * o.f * 1.6 + 1.3 + o.sy);
        band = 1 - Math.abs(Math.sin((u * o.a + v * o.b) * TAU * o.cyc + (q1 - .5) * o.warp + o.ph));
        cloud = fbm(u * o.f * 2 + q2 * 2.2, v * o.f * 3.2 + q1 * 2.2);
        env = smooth(.40, .72, fbm(u * 1.3 + o.sx * .5 + 9, v * 2.0 + o.sy * .5 + 4));
        val = clamp((band * band * .62 + Math.pow(band, 3.2) * .38 + Math.pow(band, 9) * .25) * (.3 + cloud * .95) * env * o.gain);
        map[j * gw + i] = val; k = (j * gw + i) * 4;
        d[k] = 255; d[k + 1] = 198; d[k + 2] = 214; d[k + 3] = Math.round(val * 255);
      }
      x0.putImageData(img, 0, 0);
      var cv = makeCanvas(cw, ch), c = cv.getContext('2d');
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(c0, 0, 0, cw, ch);
      /* stardust that lives inside the streaks */
      var rng = seeded(o.sx * 13 + 3), want = Math.round(o.specks * (cw * ch) / (254 * 548)), tries = want * 8, got = 0, gx, gy, a, sz;
      while (tries-- > 0 && got < want) {
        gx = Math.floor(rng() * gw); gy = Math.floor(rng() * gh);
        if (rng() < map[gy * gw + gx] * 1.4) {
          a = .3 + rng() * .7; sz = rng() < .1 ? 2 : 1;
          c.fillStyle = 'rgba(255,236,243,' + a.toFixed(2) + ')';
          c.fillRect(Math.floor((gx + rng()) / gw * cw), Math.floor((gy + rng()) / gh * ch), sz, sz); got++;
        }
      }
      return cv;
    }
    function buildWisps() {
      var ow = Math.ceil(W * 1.3), oh = Math.ceil(H * 1.3);
      if (!NT) initNoise();
      wisps  = makeNebula(ow, oh, { f: 1.7, sx: 3.9, sy: 1.3, a: .8, b: .9, cyc: .85, warp: 3.6, ph: 1.9, gain: 1.1, specks: 1700 });
      wisps2 = makeNebula(ow, oh, { f: 2.3, sx: 8.3, sy: 2.2, a: -.9, b: .7, cyc: 1.0, warp: 3.2, ph: 2.1, gain: .75, specks: 800 });
      wispW = ow; wispH = oh;
    }

    /* -------------------------------------------------------- particles */
    var MICRO_MAX = 200, GLITTER_MAX = 84;
    var micro = [], glitter = [], stars = [], tsparks = [], leaves = [];
    var dust = [], DUST_MAX = 400;
    var petals = [], leafShape = null, leafGrad = null;
    var trails = [];
    var pp = { x: 0, y: 0 };

    function initParticles() {
      var i;
      for (i = 0; i < MICRO_MAX; i++) micro.push({ x: Math.random(), y: Math.random(), z: rnd(.3, 1), s: rnd(.9, 2), a: rnd(.2, .58), ph: rnd(0, TAU), sp: rnd(.4, 1.4), vx: rnd(-.004, .004), vy: rnd(-.006, .002) });
      for (i = 0; i < GLITTER_MAX; i++) glitter.push({ x: Math.random(), y: Math.random(), z: rnd(.4, 1), s: rnd(1.8, 3.6), a: rnd(.45, .95), ph: rnd(0, TAU), sp: rnd(.6, 2.2), vx: rnd(-.003, .003), vy: rnd(-.005, .002) });
      for (i = 0; i < DUST_MAX; i++) dust.push({ on: false });
      var leafTr = [5, 5, 1, 1, 7, 0, 6, 4, 3];       // which ribbon each leaf drifts along
      for (i = 0; i < leafTr.length; i++) leaves.push({ tr: leafTr[i], s: Math.random(), v: rnd(.006, .016), off: rnd(-26, 26), sz: rnd(34, 62), tilt: rnd(-.9, .9), spin: rnd(-.05, .05), ph: rnd(0, TAU) });
      for (i = 0; i < TRAIL_DEFS.length; i++) {
        var d = TRAIL_DEFS[i], count = d.kind === 'ring' ? RING_N : (d.pts.length - 1) * SPS + 1;
        var abs = [];
        if (d.kind === 'spline') for (var j = 0; j < d.pts.length; j++) abs.push([0, 0]);
        trails.push({ def: d, abs: abs, samples: new Float32Array(count * 2), count: count, head: 0 });
        for (var q = 0; q < (d.spk || 12); q++) tsparks.push({ tr: i, s: Math.random(), v: rnd(.018, .055), off: rnd(-4, 4), size: rnd(1.6, 3.4), ph: rnd(0, TAU) });
      }
      for (i = 0; i < PETAL_DEFS.length; i++) {
        var P = PETAL_DEFS[i], sh = buildPetalShape(P), g = ctx.createLinearGradient(0, 0, 0, -1);
        g.addColorStop(0, 'rgba(255,240,244,.085)'); g.addColorStop(.3, 'rgba(255,208,220,.07)');
        g.addColorStop(.7, 'rgba(240,160,184,.06)'); g.addColorStop(1, 'rgba(255,226,234,.11)');
        var eg = ctx.createLinearGradient(0, 0, 0, -1), gg = ctx.createLinearGradient(0, 0, 0, -1), vg = ctx.createLinearGradient(0, 0, 0, -1);
        eg.addColorStop(0, 'rgba(255,238,242,.06)'); eg.addColorStop(.35, 'rgba(255,238,242,.55)'); eg.addColorStop(1, 'rgba(255,242,246,.82)');
        gg.addColorStop(0, 'rgba(255,190,208,0)'); gg.addColorStop(.4, 'rgba(255,190,208,.6)'); gg.addColorStop(1, 'rgba(255,190,208,.8)');
        vg.addColorStop(0, 'rgba(255,240,244,0)'); vg.addColorStop(.45, 'rgba(255,240,244,.8)'); vg.addColorStop(1, 'rgba(255,240,244,.6)');
        petals.push({ def: P, shape: sh, grad: g, edgeGrad: eg, glowGrad: gg, veinGrad: vg, ph: rnd(0, TAU), q: 0, cur: { ox: 0, ang: 0, scale: 1, edge: 0, fill: 0, vein: 0, di: 0 } });
      }
      leafShape = buildPetalShape({ w: .24, bend: .10, curl: .05 });
      leafGrad = ctx.createLinearGradient(0, 0, 0, -1);
      leafGrad.addColorStop(0, 'rgba(255,238,244,.34)'); leafGrad.addColorStop(.5, 'rgba(255,196,212,.22)'); leafGrad.addColorStop(1, 'rgba(255,226,234,.32)');
    }

    /* petal point in screen space (petal-local centre-line param s, lateral side −1…1) */
    function petalPoint(i, s, side) {
      var P = petals[i], sh = P.shape, cur = P.cur, f = info.flower;
      var idx = clamp(s) * sh.N, i0 = Math.min(Math.floor(idx), sh.N - 1), fr = idx - i0;
      var mx = lerp(sh.mid[i0][0], sh.mid[i0 + 1][0], fr), my = lerp(sh.mid[i0][1], sh.mid[i0 + 1][1], fr);
      var hw = lerp(sh.hw[i0], sh.hw[i0 + 1], fr);
      var lx = mx + side * hw * .92, ly = my, c = Math.cos(cur.ang), sn = Math.sin(cur.ang);
      pp.x = f.bx + cur.ox + (lx * c - ly * sn) * cur.scale;
      pp.y = f.by + (lx * sn + ly * c) * cur.scale;
    }
    function pickFormingPetal() {
      var pool = [], i;
      for (i = 0; i < petals.length; i++) if (petals[i].q > .02 && petals[i].q < .98) pool.push(i);
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
    }

    function slot() { for (var i = 0; i < DUST_MAX; i++) if (!dust[i].on) return dust[i]; return null; }
    function spawnAssemble() {
      var d = slot(); if (!d) return;
      var f = info.flower, ang = rnd(0, TAU), rad = f.L * rnd(1.1, 2.7);
      d.on = true; d.mode = 0; d.petal = pickFormingPetal(); d.s = rnd(.12, .95); d.side = rnd(-1, 1);
      d.sx = f.bx + Math.cos(ang) * rad * 1.35; d.sy = f.by - f.L * .4 + Math.sin(ang) * rad;
      d.jx = rnd(-.06, .06) * f.L; d.jy = rnd(-.06, .06) * f.L;
      d.u = 0; d.dur = rnd(.9, 1.8); d.size = rnd(1.3, 2.8); d.amp = rnd(-46, 46); d.age = 0; d.a = .2; d.src = 1;
    }
    function spawnFree(x, y, vx, vy, life, size, a, drag, src) {
      var d = slot(); if (!d) return;
      d.on = true; d.mode = 2; d.src = src || 0; d.x = x; d.y = y; d.vx = vx; d.vy = vy; d.life = life; d.age = 0; d.size = size; d.a0 = a; d.a = 0; d.drag = drag === undefined ? .55 : drag; d.ph = rnd(0, TAU);
    }
    function spawnFromPetals(n) {
      var f = info.flower, i, pi, ang, sp;
      for (i = 0; i < n; i++) {
        pi = Math.floor(Math.random() * petals.length);
        petalPoint(pi, Math.pow(Math.random(), .8), rnd(-1, 1));
        ang = Math.atan2(pp.y - (f.by - f.L * .3), pp.x - f.bx) + rnd(-.5, .5);
        sp = rnd(18, 70) * (S / 390);
        spawnFree(pp.x, pp.y, Math.cos(ang) * sp, Math.sin(ang) * sp - rnd(10, 32), rnd(.5, 1.0), rnd(1.3, 3), rnd(.55, 1), .55, 1);
      }
    }
    function emit(x, y, n, speed, life) {
      speed = speed || 40; life = life || 1.6;
      for (var i = 0; i < n; i++) {
        var a = rnd(0, TAU), v = rnd(.3, 1) * speed;
        spawnFree(x + rnd(-3, 3), y + rnd(-3, 3), Math.cos(a) * v, Math.sin(a) * v - speed * .2, life * rnd(.7, 1.3), rnd(1.3, 2.8), rnd(.6, 1));
      }
    }
    function spawnStar(x, y, size, life) {
      stars.push({ x: x, y: y, size: size, life: life, age: 0, rot: rnd(-.25, .25), spin: rnd(-.06, .06) });
    }

    /* ----------------------------------------------------------- layout */
    function resize(w, h, layoutInfo) {
      W = w; H = h; info = layoutInfo; S = info.S;
      dpr = Math.min(global.devicePixelRatio || 1, maxDPR, opts.forceDpr || 9);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      /* the backdrops are expensive to generate → only rebuild when the screen size really changed */
      if (!haze || !wisps || Math.abs(W - bW) / bW > .08 || Math.abs(H - bH) / bH > .08) {
        var t0 = (global.performance || Date).now();
        buildHaze(); buildWisps(); bW = W; bH = H;
        lastBuildMs = (global.performance || Date).now() - t0;
      }
    }
    function setPointer(nx, ny) { par.tx = nx; par.ty = ny; }

    /* ------------------------------------------------------------ update */
    function update(p, dt) {
      var mo = motion, i, d, m, u;
      var f = info.flower;

      /* parallax follows the pointer very gently */
      var pk = Math.min(1, dt * 2);
      par.x += ((reduced ? 0 : par.tx * 11 * S / 390) - par.x) * pk;
      par.y += ((reduced ? 0 : par.ty * 11 * S / 390) - par.y) * pk;

      /* drifting dust & glitter (normalised coordinates → resize-proof) */
      for (i = 0; i < MICRO_MAX; i++) {
        m = micro[i];
        m.x += (m.vx + Math.sin(time * .23 + m.ph) * .0015) * dt * mo; m.y += (m.vy + Math.cos(time * .19 + m.ph) * .0012) * dt * mo;
        if (m.x < -.03) m.x += 1.06; else if (m.x > 1.03) m.x -= 1.06;
        if (m.y < -.03) m.y += 1.06; else if (m.y > 1.03) m.y -= 1.06;
      }
      for (i = 0; i < GLITTER_MAX; i++) {
        m = glitter[i];
        m.x += (m.vx + Math.sin(time * .17 + m.ph) * .0014) * dt * mo; m.y += (m.vy + Math.cos(time * .15 + m.ph) * .001) * dt * mo;
        if (m.x < -.03) m.x += 1.06; else if (m.x > 1.03) m.x -= 1.06;
        if (m.y < -.03) m.y += 1.06; else if (m.y > 1.03) m.y -= 1.06;
      }

      /* star sparkles: appear → glow → expand → fade */
      for (i = stars.length - 1; i >= 0; i--) { stars[i].age += dt * (reduced ? .4 : 1); if (stars[i].age >= stars[i].life) stars.splice(i, 1); }
      if (!reduced) {
        acc.star += dt * p.starRate * 2.6;
        while (acc.star >= 1) {
          acc.star -= 1;
          if (stars.length < Math.round((p.starCap || 15) * quality)) {
            var rr = Math.random();
            spawnStar(rnd(.04, .96), rnd(.03, .97), rr < .5 ? rnd(16, 28) : (rr < .86 ? rnd(30, 48) : rnd(62, 94)), rnd(3.6, 7.5));
          }
        }
      }

      /* sparkles that ride the light trails */
      for (i = 0; i < tsparks.length; i++) {
        var sp = tsparks[i];
        sp.s += sp.v * dt * mo;
        if (sp.s > 1.02) { sp.s = -.02; sp.off = rnd(-4, 4); sp.v = rnd(.018, .055); }
      }

      /* leaves drift slowly along the light ribbons */
      for (i = 0; i < leaves.length; i++) {
        var lf = leaves[i];
        lf.s += lf.v * dt * mo;
        if (lf.s > 1.04) { lf.s = -.04; lf.off = rnd(-26, 26); lf.tilt = rnd(-.9, .9); }
      }

      /* dust: assembling the flower, leaving it, dissolving title / flower */
      if (!reduced) {
        var fp = p.flowerP;
        if (fp > .02 && fp < .985 && p.flowerDissolve <= 0) {
          acc.assemble += dt * lerp(32, 85, fp) * quality;
          while (acc.assemble >= 1) { acc.assemble -= 1; spawnAssemble(); }
        } else if (fp >= .985 && p.flowerDissolve <= 0) {
          acc.out += dt * 14 * quality;
          while (acc.out >= 1) { acc.out -= 1; spawnFromPetals(1); }
        }
        var dd = p.flowerDissolve - prevFlowerDiss;
        if (dd > 0) spawnFromPetals(Math.round(dd * 300 * quality) + (Math.random() < (dd * 300 * quality) % 1 ? 1 : 0));
        prevFlowerDiss = p.flowerDissolve;

        var td = p.titleDissolve - prevTitleDiss;
        if (td > 0 && info.title) {
          var tt = info.title, n = Math.round(td * 150 * quality) + (Math.random() < (td * 150 * quality) % 1 ? 1 : 0);
          for (i = 0; i < n; i++) spawnFree(tt.cx + rnd(-.5, .5) * tt.w, tt.cy + rnd(-.5, .5) * tt.h, rnd(-16, 16), rnd(-26, -4), rnd(2, 3.6), rnd(1.3, 3), rnd(.6, 1), .35);
        }
        prevTitleDiss = p.titleDissolve;
      }

      for (i = 0; i < DUST_MAX; i++) {
        d = dust[i]; if (!d.on) continue;
        if (d.src && p.dustKill >= 1) { d.on = false; continue; }
        d.age += dt;
        if (d.mode === 0) {
          d.u += dt / d.dur; u = clamp(d.u);
          var tx, ty;
          if (d.petal >= 0) { petalPoint(d.petal, d.s, d.side); tx = pp.x; ty = pp.y; }
          else { tx = f.bx + d.jx; ty = f.by - f.L * .3 + d.jy; }
          var e = easeInOutCubic(u), dx = tx - d.sx, dy = ty - d.sy, len = Math.hypot(dx, dy) || 1;
          var sw = Math.sin(Math.PI * u) * d.amp * (1 - u * .5);
          d.x = lerp(d.sx, tx, e) - dy / len * sw; d.y = lerp(d.sy, ty, e) + dx / len * sw;
          d.a = .25 + .75 * u;
          if (u >= 1) {
            if (d.petal >= 0 && Math.random() < .45) { d.mode = 1; d.age = 0; d.edgeDur = rnd(.6, 1.1); d.edgeSide = Math.random() < .5 ? -1 : 1; d.s0 = d.s; }
            else d.on = false;
          }
        } else if (d.mode === 1) {
          var v = d.age / d.edgeDur;
          if (v >= 1) { d.on = false; continue; }
          petalPoint(d.petal, lerp(d.s0, 1, easeOutCubic(v)), d.edgeSide * 1.05 * (1 - v * .3));
          d.x = pp.x; d.y = pp.y; d.a = (1 - v) * .9;
        } else {
          var k = Math.max(0, 1 - d.drag * dt);
          d.vx *= k; d.vy *= k;
          d.x += d.vx * dt + Math.sin(time * .9 + d.ph) * .12; d.y += d.vy * dt;
          var w = d.age / d.life;
          if (w >= 1) { d.on = false; continue; }
          d.a = d.a0 * smooth(0, .12, w) * (1 - smooth(.35, 1, w));
        }
      }
    }

    /* -------------------------------------------------------------- draw */
    function glow(x, y, r, a, rgb) {
      if (a < .004 || r < 1) return;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(.4, 'rgba(' + rgb + ',' + (a * .34) + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    function updateTrails(p) {
      var i, tr, def, j, pt, w = W, h = H, ph, k, cnt, th, tilt, rx, ry, cx, cy, r, ca, sa, x, y, cos2, sin2;
      for (i = 0; i < trails.length; i++) {
        tr = trails[i]; def = tr.def;
        tr.head = clamp((p.T - def.t0) / (def.t1 - def.t0)); tr.head = easeInOutCubic(tr.head) * 1.28;
        if (tr.head <= 0) continue;
        if (def.kind === 'spline') {
          for (j = 0; j < def.pts.length; j++) {
            pt = def.pts[j]; ph = j * 1.7 + i * 2.3;
            tr.abs[j][0] = (pt[0] + Math.sin(time * .13 * motion + ph) * .022 * def.amp) * w + par.x * .5;
            tr.abs[j][1] = (pt[1] + Math.sin(time * .11 * motion + ph * 1.3) * .016 * def.amp) * h + par.y * .5;
          }
          tr.count = catmull(tr.abs, tr.samples);
        } else {
          cx = info.center.x + par.x * .5; cy = info.center.y + par.y * .5; rx = info.center.rx; ry = info.center.ry;
          tilt = -.28 + Math.sin(time * .1 * motion) * .12; cos2 = Math.cos(tilt); sin2 = Math.sin(tilt);
          cnt = tr.count;
          for (k = 0; k < cnt; k++) {
            th = -1.5 + (k / (cnt - 1)) * 4.9 + time * .03 * motion;
            r = (.8 + .38 * (k / (cnt - 1))) * (1 + .05 * Math.sin(2 * th + time * .25 * motion) + .03 * Math.sin(3 * th - time * .19 * motion));
            x = Math.cos(th) * rx * r; y = Math.sin(th) * ry * r;
            tr.samples[2 * k] = cx + x * cos2 - y * sin2; tr.samples[2 * k + 1] = cy + x * sin2 + y * cos2;
          }
        }
      }
    }

    /* Lines start deep crimson and turn white only where (and when) the pink light has reached them. */
    var LN_RED = [[150, 8, 30], [190, 14, 40], [206, 24, 48]];          // glow / mid / core
    var LN_WHT = [[255, 160, 190], [255, 208, 222], [255, 247, 249]];
    function lineHeat(x, y, p) {
      var c = info.center, R = Math.max(W, H), Rg = (.08 + 1.1 * p.reach) * R;
      return Math.min(smooth(0, 1, (Rg - Math.hypot(x - c.x, y - c.y)) / (.3 * R)), p.heat);
    }
    var chunkA = new Float32Array(64), chunkH = new Float32Array(64);
    function drawTrail(tr, alpha, p) {
      if (tr.head <= 0 || alpha < .01) return;
      var s = tr.samples, n = tr.count, chunk = Math.max(2, Math.floor(n / 40)), scale = S / 390;
      var i0, i1, i, c = 0, a, sm, starts = [], pass, im, e, k, col, pi;
      for (i0 = 0; i0 < n - 1; i0 += chunk) {
        i1 = Math.min(i0 + chunk, n - 1); sm = (i0 + i1) / 2 / (n - 1); im = Math.round((i0 + i1) / 2);
        a = trailEnv(sm) * clamp((tr.head - sm) / .16) * alpha * tr.def.amp;
        chunkA[c] = a; chunkH[c] = a < .012 ? 0 : lineHeat(s[2 * im], s[2 * im + 1], p); starts[c] = i0; c++;
      }
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      var passes = (quality >= .7 && !tr.def.thin)
        ? [[7 * scale, 0, .05], [2.4 * scale, 1, .16], [.85 * scale, 2, .72]]
        : (tr.def.thin ? [[1.8 * scale, 1, .12], [.6 * scale, 2, .6]] : [[2.4 * scale, 1, .16], [.85 * scale, 2, .72]]);
      for (pass = 0; pass < passes.length; pass++) {
        ctx.lineWidth = passes[pass][0]; pi = passes[pass][1];
        for (i = 0; i < c; i++) {
          a = chunkA[i]; if (a < .012) continue;
          i0 = starts[i]; i1 = Math.min(i0 + chunk, n - 1);
          e = chunkH[i]; e = e * e * (3 - 2 * e);
          col = 'rgba(' + Math.round(LN_RED[pi][0] + (LN_WHT[pi][0] - LN_RED[pi][0]) * e) + ',' + Math.round(LN_RED[pi][1] + (LN_WHT[pi][1] - LN_RED[pi][1]) * e) + ',' + Math.round(LN_RED[pi][2] + (LN_WHT[pi][2] - LN_RED[pi][2]) * e) + ',';
          ctx.beginPath(); ctx.moveTo(s[2 * i0], s[2 * i0 + 1]);
          for (k = i0 + 1; k <= i1; k++) ctx.lineTo(s[2 * k], s[2 * k + 1]);
          ctx.strokeStyle = col + (a * passes[pass][2]).toFixed(3) + ')'; ctx.stroke();
        }
      }
      /* bright head while the trail is still being drawn */
      if (tr.head < 1.2) {
        var hi = clamp(tr.head, 0, 1) * (n - 1), h0 = Math.floor(hi), hf = hi - h0, h1 = Math.min(h0 + 1, n - 1);
        var hx = lerp(s[2 * h0], s[2 * h1], hf), hy = lerp(s[2 * h0 + 1], s[2 * h1 + 1], hf);
        var ha = alpha * (1 - smooth(1.0, 1.2, tr.head)) * smooth(0, .06, tr.head);
        if (ha > .01) { var hs = 26 * scale; ctx.globalAlpha = ha; ctx.drawImage(spr.dotT[hIdx(lineHeat(hx, hy, p))], hx - hs / 2, hy - hs / 2, hs, hs); ctx.globalAlpha = 1; }
      }
    }

    function drawTrailSparks(p) {
      var i, sp, tr, n, idx, i0, i1, f, x, y, dx, dy, l, vis, tw, size, sc = S / 390;
      for (i = 0; i < tsparks.length; i++) {
        sp = tsparks[i]; tr = trails[sp.tr];
        if (tr.head <= 0 || sp.s < 0 || sp.s > 1) continue;
        vis = trailEnv(sp.s) * clamp((tr.head - sp.s) / .16) * p.trailAlpha * tr.def.amp;
        if (vis < .03) continue;
        n = tr.count; idx = sp.s * (n - 1); i0 = Math.min(Math.floor(idx), n - 2); i1 = i0 + 1; f = idx - i0;
        x = lerp(tr.samples[2 * i0], tr.samples[2 * i1], f); y = lerp(tr.samples[2 * i0 + 1], tr.samples[2 * i1 + 1], f);
        dx = tr.samples[2 * i1] - tr.samples[2 * i0]; dy = tr.samples[2 * i1 + 1] - tr.samples[2 * i0 + 1]; l = Math.hypot(dx, dy) || 1;
        x += -dy / l * sp.off; y += dx / l * sp.off;
        tw = .55 + .45 * Math.sin(time * 3.1 + sp.ph);
        size = sp.size * 6 * sc * (.85 + .3 * tw);
        ctx.globalAlpha = clamp(vis * tw * 1.1);
        ctx.drawImage(spr.dotT[hIdx(lineHeat(x, y, p))], x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    function drawParticles(p) {
      var i, m, a, px, py, sz, tw, sc = clamp(S / 390, .8, 1.3), n, hi = hIdx(p.heat), pin = spr.pinT[hi], dt = spr.dotT[hi];
      n = Math.min(MICRO_MAX, Math.round(MICRO_MAX * .66 * clamp(W * H / (390 * 844), .7, 1.7) * quality * (p.dens === undefined ? 1 : p.dens) * (reduced ? .5 : 1)));
      for (i = 0; i < n; i++) {
        m = micro[i]; tw = reduced ? .85 : .72 + .28 * Math.sin(time * m.sp + m.ph);
        a = m.a * tw * p.micro; if (a < .01) continue;
        px = m.x * W + par.x * m.z; py = m.y * H + par.y * m.z; sz = m.s * 2.4 * sc;
        ctx.globalAlpha = a; ctx.drawImage(pin, px - sz / 2, py - sz / 2, sz, sz);
      }
      n = Math.min(GLITTER_MAX, Math.round(GLITTER_MAX * .46 * clamp(W * H / (390 * 844), .7, 1.7) * quality * (p.dens === undefined ? 1 : p.dens) * (reduced ? .6 : 1)));
      for (i = 0; i < n; i++) {
        m = glitter[i]; tw = reduced ? .7 : .5 + .5 * Math.sin(time * m.sp + m.ph);
        a = m.a * (.25 + .75 * tw) * p.glitter; if (a < .01) continue;
        px = m.x * W + par.x * m.z; py = m.y * H + par.y * m.z; sz = m.s * 6 * sc * (.85 + .3 * tw);
        ctx.globalAlpha = a; ctx.drawImage(dt, px - sz / 2, py - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
    }

    function drawDust(p) {
      var i, d, sz, sc = S / 390, tw, dt = spr.dotT[hIdx(p.heat)];
      for (i = 0; i < DUST_MAX; i++) {
        d = dust[i]; if (!d.on || d.a < .01) continue;
        tw = .75 + .25 * Math.sin(time * 7 + i);
        sz = d.size * 5.5 * sc;
        ctx.globalAlpha = clamp(d.a * tw * .85 * (d.src ? 1 - p.dustKill : 1)); ctx.drawImage(dt, d.x - sz / 2, d.y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
    }

    function drawStars(p) {
      var i, s, u, env, sc, sz, px, py, st = spr.starT[hIdx(p.heat)];
      for (i = 0; i < stars.length; i++) {
        s = stars[i]; u = s.age / s.life;
        env = Math.pow(Math.sin(Math.PI * clamp(u)), 1.5);
        if (env < .02) continue;
        sc = .55 + .6 * env; sz = s.size * sc * (S / 390) * (p.starScale === undefined ? 1 : p.starScale);
        px = s.x * W + par.x * .7; py = s.y * H + par.y * .7;
        ctx.save(); ctx.translate(px, py); ctx.rotate(s.rot + s.spin * s.age);
        ctx.globalAlpha = clamp(env * 1.05); ctx.drawImage(st, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function drawLeaves(p) {
      var alpha = p.leafA;
      if (alpha < .01 || reduced) return;
      var i, lf, tr, n, idx, i0, i1, f, x, y, dx, dy, l, vis, sz, ang;
      for (i = 0; i < leaves.length; i++) {
        lf = leaves[i]; tr = trails[lf.tr];
        if (tr.head <= 0 || lf.s < 0 || lf.s > 1) continue;
        vis = trailEnv(lf.s) * clamp((tr.head - lf.s) / .16);
        if (vis < .05) continue;
        n = tr.count; idx = lf.s * (n - 1); i0 = Math.min(Math.floor(idx), n - 2); i1 = i0 + 1; f = idx - i0;
        x = lerp(tr.samples[2 * i0], tr.samples[2 * i1], f); y = lerp(tr.samples[2 * i0 + 1], tr.samples[2 * i1 + 1], f);
        dx = tr.samples[2 * i1] - tr.samples[2 * i0]; dy = tr.samples[2 * i1 + 1] - tr.samples[2 * i0 + 1]; l = Math.hypot(dx, dy) || 1;
        x += -dy / l * lf.off * (S / 390) + par.x * .8; y += dx / l * lf.off * (S / 390) + par.y * .8;
        ang = Math.atan2(dx, -dy) + lf.tilt + Math.sin(time * .5 + lf.ph) * .25;
        sz = lf.sz * (S / 390);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(sz, sz);
        var a = alpha * vis * (.72 + .28 * Math.sin(time * .8 + lf.ph));
        ctx.globalAlpha = a; ctx.fillStyle = leafGrad; ctx.fill(leafShape.fill);
        ctx.lineCap = 'round';
        ctx.lineWidth = .9 / sz; ctx.strokeStyle = 'rgb(255,238,244)'; ctx.globalAlpha = a * .8; ctx.stroke(leafShape.left); ctx.stroke(leafShape.right);
        ctx.lineWidth = .7 / sz; ctx.globalAlpha = a * .42; ctx.stroke(leafShape.rib); ctx.stroke(leafShape.vl); ctx.stroke(leafShape.vr);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    /* --- the lily ------------------------------------------------------- */
    function updateFlower(p) {
      var fp = p.flowerP, f = info.flower, bp = p.bloomPulse, dEase = easeInOutCubic(p.flowerDissolve);
      var bloomed = smooth(.97, 1, fp), i, P, q, open, grow, c;
      for (i = 0; i < petals.length; i++) {
        P = petals[i]; c = P.cur; q = clamp((fp - P.def.s) / P.def.d); P.q = q;
        open = easeOutCubic(clamp((q - .08) / .92));
        grow = .42 + .58 * easeOutExpo(clamp(q / .85));
        c.ang = P.def.a * (.14 + .86 * open) + (reduced ? 0 : Math.sin(time * .7 + P.ph) * .014 * bloomed * (P.def.a ? 1 : .6));
        c.scale = f.L * P.def.k * grow * (1 + bp * .045);
        c.ox = Math.sin(P.def.a) * .05 * f.L * open;
        c.edge = easeOutCubic(clamp(q / .55));
        c.fill = easeOutCubic(clamp((q - .22) / .6));
        c.vein = easeOutCubic(clamp((q - .5) / .5));
        c.di = clamp(dEase * 1.5 - P.def.ord * .10);
      }
    }

    function drawPetal(P, residual) {
      var c = P.cur, k = c.scale, inv = 1 / k, f = info.flower, sh = P.shape;
      if (c.edge < .002 && c.fill < .002) return;
      var fillA = c.fill * P.def.am * lerp(1, residual, c.di);
      var lineA = Math.max(1 - c.di, residual * 1.3);
      ctx.save();
      ctx.translate(f.bx + c.ox + par.x * .6, f.by + par.y * .6); ctx.rotate(c.ang); ctx.scale(k, k);
      if (fillA > .004) { ctx.globalAlpha = fillA; ctx.fillStyle = P.grad; ctx.fill(sh.fill); }
      if (lineA > .01) {
        ctx.lineCap = 'round';
        ctx.setLineDash([sh.len * c.edge, sh.len * 3]);
        if (quality >= .7) { ctx.lineWidth = 6 * inv; ctx.globalAlpha = .045 * lineA * (.4 + .6 * c.fill); ctx.strokeStyle = P.glowGrad; ctx.stroke(sh.left); ctx.stroke(sh.right); }
        ctx.lineWidth = 1.0 * inv; ctx.globalAlpha = (.38 + .28 * c.fill) * lineA; ctx.strokeStyle = P.edgeGrad; ctx.stroke(sh.left); ctx.stroke(sh.right);
        if (c.vein > .01) {
          ctx.setLineDash([sh.vlen * c.vein, sh.vlen * 3]);
          ctx.lineWidth = .8 * inv; ctx.globalAlpha = .32 * c.vein * lineA; ctx.strokeStyle = P.veinGrad;
          ctx.stroke(sh.rib); ctx.stroke(sh.vl); ctx.stroke(sh.vr);
        }
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    function drawStamens(p) {
      var t = clamp((p.flowerP - .80) / .14) * (1 - p.flowerDissolve);
      if (t < .01) return;
      var f = info.flower, bx = f.bx + par.x * .6, by = f.by + par.y * .6, i, ang, len, sw, ex, ey, cx, cy, e = easeOutCubic(t);
      ctx.lineCap = 'round'; ctx.lineWidth = .9 * (S / 390);
      for (i = 0; i < 5; i++) {
        ang = -.42 + i * .21 + Math.sin(time * .9 + i * 1.7) * .02 * (reduced ? 0 : 1);
        len = f.L * (.52 + .05 * ((i * 7) % 3)) * e;
        sw = (i - 2) * .05 * f.L;
        ex = bx + Math.sin(ang) * len + sw; ey = by - Math.cos(ang) * len;
        cx = bx + Math.sin(ang) * len * .45 + sw * .2; cy = by - Math.cos(ang) * len * .55;
        ctx.globalAlpha = .38 * e; ctx.strokeStyle = 'rgb(255,232,238)';
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
        var ds = 8 * (S / 390); ctx.globalAlpha = .55 * e; ctx.drawImage(spr.dot, ex - ds / 2, ey - ds / 2, ds, ds);
      }
      ctx.globalAlpha = 1;
    }

    /* ---------------------------------------------------------- draw all */
    function draw(p) {
      var f = info.flower, i, R = Math.max(W, H), c0 = info.center;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

      /* the very first frames: nothing at all — pure #000 */
      if (p.blackout || p.fadeIn < .002) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }

      /* base haze (slow drift) */
      var mx = (hazeW - W) / 2, my = (hazeH - H) / 2, dr = reduced ? .1 : 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(haze, -mx + Math.sin(time * .05) * mx * .5 * dr + par.x * .25, -my + Math.cos(time * .04) * my * .5 * dr + par.y * .25, hazeW, hazeH);

      /* nebula wisps (drawn before the darkness, so they are only seen where the light has reached) */
      ctx.globalCompositeOperation = 'lighter';
      if (p.wisp > .004) {
        ctx.globalAlpha = p.wisp;
        ctx.drawImage(wisps, -(wispW - W) / 2 + Math.sin(time * .07 + 1) * (wispW - W) * .4 * dr + par.x * .4, -(wispH - H) / 2 + Math.cos(time * .06 + 2) * (wispH - H) * .4 * dr + par.y * .4, wispW, wispH);
        ctx.globalAlpha = p.wisp * .6;      // a second, finer layer that drifts differently → depth
        ctx.drawImage(wisps2, -(wispW - W) / 2 + Math.cos(time * .05 + 3) * (wispW - W) * .4 * dr - par.x * .3, -(wispH - H) / 2 + Math.sin(time * .045 + 1) * (wispH - H) * .4 * dr - par.y * .3, wispW, wispH);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';

      /* black → the scene: the pink atmosphere is revealed from the centre outwards */
      var reachR = (.08 + 1.1 * p.reach) * R;
      var aIn = 1 - (1 - p.dark) * p.fadeIn;
      var aOut = 1 - (1 - lerp(1, p.dark, smooth(.7, 1, p.reach))) * p.fadeIn;
      if (aIn > .002 || aOut > .002) {
        var dg = ctx.createRadialGradient(c0.x, c0.y, reachR * .5, c0.x, c0.y, reachR * 1.35);
        dg.addColorStop(0, 'rgba(0,0,0,' + aIn.toFixed(3) + ')'); dg.addColorStop(1, 'rgba(0,0,0,' + aOut.toFixed(3) + ')');
        ctx.fillStyle = dg; ctx.fillRect(0, 0, W, H);
      }

      /* soft vignette that follows the screen shape (the reference is slightly darker toward its edges) */
      if (p.vignette > .01) {
        ctx.save(); ctx.translate(W / 2, H * .5); ctx.scale(W / 2, H / 2);
        var vg = ctx.createRadialGradient(0, 0, .5, 0, 0, 1.3);
        vg.addColorStop(0, 'rgba(50,8,20,0)'); vg.addColorStop(1, 'rgba(50,8,20,' + p.vignette + ')');
        ctx.fillStyle = vg; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
      }

      /* the last frame: flat salmon-pink field measured from the final reference */
      if (p.finalMix > .002) {
        var fg = ctx.createLinearGradient(0, 0, 0, H);
        fg.addColorStop(0, 'rgb(207,115,124)'); fg.addColorStop(.6, 'rgb(205,114,123)'); fg.addColorStop(1, 'rgb(203,110,119)');
        ctx.globalAlpha = p.finalMix; ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      }

      ctx.globalCompositeOperation = 'lighter';

      /* first light: a deep red glow that warms to pink as the atmosphere expands */
      if (p.atmos > .004) {
        var hg = clamp(p.heat);
        glow(c0.x, c0.y, reachR * .95, p.atmos * p.fadeIn, Math.round(lerp(150, 232, hg)) + ',' + Math.round(lerp(10, 112, hg)) + ',' + Math.round(lerp(30, 140, hg)));
      }

      /* soft light behind the title */
      var th = clamp(p.heat);
      glow(info.title.cx + par.x * .3, info.title.cy + par.y * .3, info.title.w * .95, p.titleGlow * p.fadeIn, Math.round(lerp(190, 255, th)) + ',' + Math.round(lerp(60, 208, th)) + ',' + Math.round(lerp(80, 224, th)));

      /* light trails */
      updateTrails(p);
      for (i = 0; i < trails.length; i++) drawTrail(trails[i], p.trailAlpha * p.fadeIn, p);
      drawTrailSparks(p);

      /* lily glow — restrained (and gone the moment the flower has dissolved) */
      var fp = p.flowerP, dE = easeInOutCubic(p.flowerDissolve), lily = p.flowerDissolve < 1;
      var gA = (smooth(.2, .42, fp) * .09 + smooth(.7, .95, fp) * .07 + p.bloomPulse * .07);
      gA = gA * (1 - dE * .8) + p.residual * .35 * dE;
      var gr = f.L * (1.0 + smooth(.7, 1, fp) * .3 + p.bloomPulse * .2);
      if (lily) glow(f.bx + par.x * .6, f.by - f.L * .42 + par.y * .6, gr, gA, '255,190,210');
      /* the first tiny concentration of light */
      var seed = smooth(.12, .3, fp) * (1 - smooth(.38, .6, fp)) * .4;
      if (lily && seed > .01) glow(f.bx + par.x * .6, f.by - f.L * .12 + par.y * .6, f.L * .26, seed * .7, '255,226,234');

      /* petals: back layer first */
      if (fp > .3 && lily) {
        updateFlower(p);
        var residual = p.residual;
        for (i = 0; i < petals.length; i++) if (petals[i].def.layer === 0) drawPetal(petals[i], residual);
        for (i = 0; i < petals.length; i++) if (petals[i].def.layer === 1) drawPetal(petals[i], residual);
        drawStamens(p);
        /* soft core */
        var core = smooth(.35, .95, fp) * (1 - dE * .85) + p.bloomPulse * .08;
        glow(f.bx + par.x * .6, f.by - f.L * .05 + par.y * .6, f.L * (.16 + .16 * smooth(.6, 1, fp) + p.bloomPulse * .06), core * .1, '255,236,242');
      } else if (!lily) { for (i = 0; i < petals.length; i++) petals[i].q = 1; } else { for (i = 0; i < petals.length; i++) petals[i].q = 0; }

      drawLeaves(p);
      drawDust(p);
      drawParticles(p);
      drawStars(p);

      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }

    /* ---------------------------------------------------------- public */
    function frame(p) {
      motion = p.motion; reduced = p.reduced; time = p.time;
      /* adaptive quality: if the device struggles, quietly do less */
      if (p.rawDt > 1 / 38 && p.rawDt < .25) slow++; else slow = Math.max(0, slow - 2);
      if (slow > 90 && quality > .5) {
        quality = quality > .75 ? .7 : .5; slow = 0;
        if (quality < .6 && dpr > 1.25 && W) { opts.forceDpr = 1.25; resize(W, H, info); }
      }
      if (!started) { started = true; prevTitleDiss = p.titleDissolve; prevFlowerDiss = p.flowerDissolve; }
      update(p, p.dt);
      draw(p);
    }

    initParticles();
    buildSprites();

    return {
      resize: resize,
      frame: frame,
      setPointer: setPointer,
      emit: emit,
      flare: function (nx, ny, size, life) { spawnStar(nx, ny, size, life); },
      buildMs: function () { return lastBuildMs; },
      setReduced: function (r) { reduced = r; },
      setTitle: function (cx, cy) { info.title.cx = cx; info.title.cy = cy; }
    };
  }

  global.CL = global.CL || {};
  global.CL.createFX = createFX;
  global.CL.math = { clamp: clamp, lerp: lerp, smooth: smooth, easeOutCubic: easeOutCubic, easeOutExpo: easeOutExpo, easeInOutCubic: easeInOutCubic, rnd: rnd };
})(window);
