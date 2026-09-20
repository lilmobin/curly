/* ==========================================================================
   main.js — the director
   One master timeline `T` (seconds) drives the whole experience so the intro,
   the loading bloom and the final screen read as ONE continuous scene.

     0.0 ─ haze only ─ sparkles ─ trails draw ─ title revealed by passing light
     ─ title dissolves ─ glass panel ─ LOADING (lily blooms in sync with the bar)
     ─ 100 % ─ glow swells ─ lily dissolves into dust ─ title + player appear ─ calm

   Debug helpers (URL): ?t=8.5  start at a moment · ?freeze  stop the timeline
                        ?speed=3  play faster
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.CURLY_CONFIG || {};
  var M = window.CL.math, clamp = M.clamp, lerp = M.lerp, smooth = M.smooth, easeOutCubic = M.easeOutCubic, easeInOutCubic = M.easeInOutCubic;
  var TAU = Math.PI * 2;
  function $(id) { return document.getElementById(id); }

  var q = new URLSearchParams(location.search);
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var reduced = mq.matches;

  /* ------------------------------------------------------------ timing */
  var TM = {
    titleStart: 2.8, titleSweepEnd: 4.0, dissStart: 4.9, dissEnd: 5.7, panelIn: 5.3, loadStart: 5.7
  };
  var k;
  for (k in (CFG.timing || {})) TM[k] = CFG.timing[k];
  var DUR = Math.max(.6, (CFG.loading && CFG.loading.duration) || 2.8);
  var L0 = TM.loadStart, F = L0 + DUR;                                   // loading start / finish
  var OUT = { pulse: .9, dissStart: .6, dissEnd: 2.4, morph: .6, titleIn: .9, titleDur: 1.4, autoplay: 1.8 };
  var TF = F + OUT.titleIn;                                              // final title reveal

  function kf(t, a) {
    if (t <= a[0][0]) return a[0][1];
    for (var i = 1; i < a.length; i++) {
      if (t <= a[i][0]) { var u = (t - a[i - 1][0]) / (a[i][0] - a[i - 1][0]); u = u * u * (3 - 2 * u); return a[i - 1][1] + (a[i][1] - a[i - 1][1]) * u; }
    }
    return a[a.length - 1][1];
  }
  var KF = {
    /* darkness over the scene: 1 = pure black. Light is revealed from the centre (see reach). */
    dark:     [[0, 1], [.9, 1], [1.6, .92], [2.8, .66], [4.8, .40], [L0, .20], [F, .10], [F + .4, .10], [F + 2.4, 0]],
    reach:    [[1.3, 0], [5.6, 1]],                     // how far the pink atmosphere has expanded
    heat:     [[1.6, 0], [5.2, 1]],                     // crimson → white for lines, dust and sparkles
    atmos:    [[1.2, 0], [2.4, .14], [4.0, .18], [L0, .10], [F, .03], [F + 2.4, 0]],
    vignette: [[0, 0], [2.5, .10], [L0, .16], [F + 2.4, .12]],
    wisp:     [[0, 0], [2.6, 0], [3.6, .10], [4.8, .20], [L0 + .8, .28], [F, .28], [F + 2.6, .04]],
    titleGlow:[[1.8, 0], [3.2, .20], [4.8, .22], [L0, .08], [F + .9, .05], [F + 2.4, .04]],
    trail:    [[.9, 0], [2, .55], [4, .8], [L0, .7], [F, .6], [F + 2.6, .10]],
    micro:    [[0, 0], [1.5, 0], [2.4, .3], [4, .65], [F + 2.6, .5]],
    glitter:  [[1.6, 0], [2.6, .45], [3.8, .75], [F + 2.6, .42]],
    star:     [[1.4, 0], [2.2, .28], [4, .6], [L0, .5], [F + 2.6, .22]],
    leaf:     [[L0 + 1, 0], [F, .22], [F + 2.6, .13]]
  };
  function progEase(u) { var s = u * u * (3 - 2 * u); return u * .4 + s * .6; }
  function pOf(T) { return T < L0 ? 0 : progEase(clamp((T - L0) / DUR)); }

  /* -------------------------------------------------------------- DOM */
  var body = document.body;
  var el = {
    canvas: $('fx'), title: $('title'), titleImg: $('titleImg'), titleGlow: $('titleGlow'), orb: $('orb'),
    card: $('card'), loadingUI: $('loadingUI'), loadTrack: $('loadTrack'), loadFill: $('loadFill'), loadDot: $('loadDot')
  };
  function setVar(node, name, val) { var c = node.__c || (node.__c = {}); if (c[name] !== val) { c[name] = val; node.style.setProperty(name, val); } }
  function setStyle(node, name, val) { var c = node.__s || (node.__s = {}); if (c[name] !== val) { c[name] = val; node.style[name] = val; } }

  /* ------------------------------------------------------------ assets */
  var assets = { title: { done: false, w: 1 }, cover: { done: false, w: .5 }, audio: { done: false, w: 1 } };
  function assetDone(n) { assets[n].done = true; }
  function assetFrac() { var s = 0, t = 0, n; for (n in assets) { t += assets[n].w; if (assets[n].done) s += assets[n].w; } return s / t; }
  function loadCap() { var f = assetFrac(); return f >= 1 ? 1 : .35 + .65 * f * .999; }
  setTimeout(function () { for (var n in assets) assets[n].done = true; }, CFG.assetTimeout || 8000);

  var titleAspect = .42, titleMissing = false;
  el.titleImg.addEventListener('load', function () {
    if (el.titleImg.naturalWidth) titleAspect = el.titleImg.naturalHeight / el.titleImg.naturalWidth;
    assetDone('title'); layout();
  });
  el.titleImg.addEventListener('error', function () {
    titleMissing = true; assetDone('title'); el.title.style.display = 'none';
    if (window.console) console.warn('[for Curly Lily] Title image not found: ' + (CFG.title && CFG.title.src) + ' — put your transparent PNG there (see js/config.js).');
  });
  var tsrc = (CFG.title && CFG.title.src) || 'assets/title.png';
  el.titleImg.alt = (CFG.title && CFG.title.alt) || 'for Curly Lily';
  el.titleImg.src = tsrc; el.titleGlow.src = tsrc;

  /* ------------------------------------------------------------ engine */
  var fx = window.CL.createFX(el.canvas, { maxDPR: CFG.maxDPR || 2, reduced: reduced });
  var player = window.CL.createPlayer(CFG, {
    onCover: function () { assetDone('cover'); },
    onAudioReady: function () { assetDone('audio'); },
    onHeart: function (x, y) { fx.emit(x, y, 14, 46, 1.4); }
  });

  /* ------------------------------------------------------------ layout */
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);

  var G = { vw: 390, vh: 844, cx: 195, titleCY: 300, titleW: 312, titleH: 131, cardCY: 500 };
  var trackW = 0;
  if (window.ResizeObserver) new ResizeObserver(function () { trackW = el.loadTrack.clientWidth; }).observe(el.loadTrack);

  function layout() {
    var root = document.documentElement, cs = getComputedStyle(probe);
    var vw = root.clientWidth || window.innerWidth, vh = window.innerHeight;
    var safeTop = parseFloat(cs.paddingTop) || 0, safeBot = parseFloat(cs.paddingBottom) || 0;

    var S = Math.min(vw, 460, vh * .56);                       // composition unit (phone: full width; desktop: compact)
    var u = clamp(S / 390, .9, 1.04);
    var titleW = .80 * S, titleH = titleW * (titleMissing ? .42 : titleAspect);
    var cardW = Math.min(Math.max(.76 * S, 272), vw - 32), cardH = 142 * u;
    var loadW = Math.min(Math.max(.70 * S, 240), cardW), loadH = 92 * u;
    var gap = .16 * S, groupH = titleH + gap + cardH;
    var cy = (safeTop + (vh - safeBot)) / 2 - .02 * vh;
    var top = cy - groupH / 2;
    var titleCY = top + titleH / 2, cardCY = top + titleH + gap + cardH / 2;

    var st = root.style;
    st.setProperty('--u', u.toFixed(3));
    st.setProperty('--title-w', titleW.toFixed(1) + 'px'); st.setProperty('--title-cy', titleCY.toFixed(1) + 'px');
    st.setProperty('--card-cy', cardCY.toFixed(1) + 'px'); st.setProperty('--card-w', cardW.toFixed(1) + 'px'); st.setProperty('--card-h', cardH.toFixed(1) + 'px');
    st.setProperty('--load-w', loadW.toFixed(1) + 'px'); st.setProperty('--load-h', loadH.toFixed(1) + 'px');

    G = { vw: vw, vh: vh, cx: vw / 2, titleCY: titleCY, titleW: titleW, titleH: titleH, cardCY: cardCY };
    fx.resize(vw, vh, {
      S: S,
      flower: { bx: vw / 2, by: cardCY - cardH / 2 + .2 * cardH, L: .40 * S },
      title: { cx: vw / 2, cy: titleCY, w: titleW, h: titleH },
      center: { x: vw / 2, y: (titleCY + cardCY) / 2, rx: Math.min(.46 * vw, .95 * S), ry: Math.min(.19 * vh, .62 * S) }
    });
    trackW = el.loadTrack.clientWidth; player.measure();
  }
  var rzT = 0;
  function onResize() { clearTimeout(rzT); rzT = setTimeout(layout, 120); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  layout();

  window.addEventListener('pointermove', function (e) {
    if (reduced) return;
    fx.setPointer((e.clientX / G.vw - .5) * 2, (e.clientY / G.vh - .5) * 2);
  }, { passive: true });

  /* ----------------------------------------------------------- timeline */
  var T = parseFloat(q.get('t')) || 0;
  var speed = parseFloat(q.get('speed')) || 1, freeze = q.has('freeze');
  if (reduced) T = Math.max(T, F + .7);                   // skip the cinematic sequence, just fade in calmly
  var time = 0, titleHold = 0, stage = '', flags = { flare1: T > 1.15, flare2: T > 3.9, flare3: T > F + 1.2, autoplay: T > F + OUT.autoplay };

  mq.addEventListener && mq.addEventListener('change', function (e) {
    reduced = e.matches; fx.setReduced(reduced);
    if (reduced) T = Math.max(T, F + .7);
  });

  /* title: opacity / blur / glow / light-sweep for a given moment */
  var TS = { r: 0, o: 0, b: 0, g: 0, s: 1 };
  function reveal(t, t0, dur, blur0, peak) {
    var u = clamp((t - t0) / dur);
    TS.r = reduced ? 1 : easeInOutCubic(u);
    TS.o = smooth(0, 1, u);
    TS.b = reduced ? 0 : blur0 * (1 - easeOutCubic(clamp((t - t0) / (dur * 1.25))));
    TS.g = reduced ? .3 * TS.o : smooth(0, .85, u) * (1 - smooth(t0 + dur, t0 + dur + 1.2, t) * .62) * peak;
    TS.s = 1;
  }
  function titleAt(t) {
    if (t < TM.dissStart) reveal(t, TM.titleStart, TM.titleSweepEnd - TM.titleStart, 8, 1);
    else if (t < TM.dissEnd) {
      reveal(t, TM.titleStart, TM.titleSweepEnd - TM.titleStart, 8, 1);
      var d = smooth(TM.dissStart, TM.dissEnd, t);
      TS.o *= 1 - d; TS.b = 10 * d; TS.g *= 1 - d; TS.s = 1 + .035 * d;
    } else if (t < TF) { TS.r = 1; TS.o = 0; TS.b = 0; TS.g = 0; TS.s = 1; }
    else reveal(t, TF, OUT.titleDur, 6, .6);
    return TS;
  }

  var P = {};   // params handed to the engine, reused every frame
  var lastProg = -1, lastPct = -1, orbAcc = 0;

  function step(dt) {
    var adv = dt * speed;
    if (!freeze) {
      if (T < TM.titleStart && T + adv >= TM.titleStart && !assets.title.done && titleHold < 6) { T = TM.titleStart - .001; titleHold += dt; adv = 0; }
      else if (T >= L0 && T < F && pOf(T) >= loadCap()) adv = 0;              // loading waits for a slow asset
      T += adv;
    }
  }

  function render(dt, rawDt) {
    var prog = pOf(T), ts = titleAt(T), tt = G.titleW * 1.2;

    /* ---- stages of the glass card ---- */
    var st = T >= F + OUT.morph ? 'player' : (T >= TM.panelIn ? 'loading' : 'hidden');
    if (st !== stage) {
      stage = st; el.card.setAttribute('data-stage', st);
      el.loadingUI.setAttribute('aria-hidden', st === 'player' ? 'true' : 'false');
    }
    body.setAttribute('data-state', T < TM.panelIn ? 'intro' : (T < F + OUT.morph ? 'loading' : 'final'));

    /* ---- loading bar (tied to the same progress the lily uses) ---- */
    if (Math.abs(prog - lastProg) > .0004) {
      lastProg = prog;
      el.loadFill.style.transform = 'scaleX(' + prog.toFixed(4) + ')';
      el.loadDot.style.transform = 'translateX(' + (prog * trackW).toFixed(1) + 'px)';
      var pct = Math.round(prog * 100);
      if (pct !== lastPct) { lastPct = pct; el.loadingUI.setAttribute('aria-valuenow', String(pct)); }
    }

    /* ---- title ---- */
    if (!titleMissing) {
      setStyle(el.title, 'opacity', ts.o.toFixed(3));
      var masked = ts.r < .999;
      if (masked !== el.title.__m) { el.title.__m = masked; el.title.classList.toggle('masked', masked); }
      if (masked) setVar(el.title, '--mp', (lerp(.65, .04, ts.r) * 100).toFixed(2) + '%');
      setVar(el.title, '--b', ts.b.toFixed(2) + 'px');
      setVar(el.title, '--ts', ts.s.toFixed(4));
      setStyle(el.titleGlow, 'opacity', ts.g.toFixed(3));
    }

    /* ---- the travelling point of light ---- */
    var ou = clamp((T - TM.titleStart) / (TM.titleSweepEnd - TM.titleStart)), oa = 0;
    if (!reduced && !titleMissing && ou > 0 && ou < 1) {
      oa = smooth(0, .1, ou) * (1 - smooth(.85, 1, ou));
      var r = easeInOutCubic(ou), pos = lerp(.65, .04, r);
      var ox = G.cx - tt / 2 + tt * (1.1895 - 2 * pos);
      var oy = G.titleCY + Math.sin(r * TAU * 1.6) * .13 * G.titleH - .03 * G.titleH;
      el.orb.style.transform = 'translate3d(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px,0)';
      orbAcc += dt * 46 * oa;
      var n = Math.floor(orbAcc); if (n > 0) { orbAcc -= n; fx.emit(ox, oy, n, 22, 1.5); }
    }
    setStyle(el.orb, 'opacity', oa.toFixed(3));

    /* ---- scripted sparkle moments ---- */
    if (!reduced) {
      if (!flags.flare1 && T > 1.15) { flags.flare1 = true; fx.flare(.63, .17, 92, 4.4); }
      if (!flags.flare2 && T > 3.9) { flags.flare2 = true; fx.flare(.27, .29, 58, 3.6); fx.flare(.74, .43, 50, 3.4); }
      if (!flags.flare3 && T > F + 1.2) { flags.flare3 = true; fx.flare(.7, .27, 60, 3.6); }
    }

    /* ---- autoplay: once, silently ---- */
    if (!flags.autoplay && T > F + OUT.autoplay) { flags.autoplay = true; player.tryAutoplay(); }

    /* ---- params for the canvas ---- */
    P.dt = dt; P.rawDt = rawDt; P.time = time; P.T = T; P.reduced = reduced; P.motion = reduced ? .12 : 1;
    P.blackout = !reduced && T < .7;                                  // first frames: nothing but #000
    P.fadeIn = smooth(0, reduced ? .9 : .5, time);
    P.dark = kf(T, KF.dark); P.reach = kf(T, KF.reach); P.heat = kf(T, KF.heat); P.atmos = reduced ? 0 : kf(T, KF.atmos);
    P.vignette = kf(T, KF.vignette); P.wisp = reduced ? .03 : kf(T, KF.wisp);
    P.titleGlow = kf(T, KF.titleGlow); P.trailAlpha = reduced ? .14 : kf(T, KF.trail);
    P.micro = kf(T, KF.micro); P.glitter = kf(T, KF.glitter); P.starRate = kf(T, KF.star);
    P.leafA = reduced ? 0 : kf(T, KF.leaf);
    P.flowerP = reduced ? 0 : prog;
    P.bloomPulse = (reduced || T < F) ? 0 : Math.sin(Math.PI * clamp((T - F) / OUT.pulse));
    P.flowerDissolve = reduced ? 0 : smooth(F + OUT.dissStart, F + OUT.dissEnd, T);
    P.residual = reduced ? 0 : (CFG.residualFlower === undefined ? .05 : CFG.residualFlower);
    P.titleDissolve = smooth(TM.dissStart, TM.dissEnd, T);
    fx.frame(P);
    player.tick();
  }

  var last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) last = now;
    var raw = (now - last) / 1000; last = now;
    if (raw > .25) raw = .016;                              // tab was in the background
    var dt = Math.min(raw, .05);
    time += dt; step(dt); render(dt, raw);
  }
  requestAnimationFrame(loop);

  /* handy for debugging / your own tweaks in the console */
  window.CL.debug = { get T() { return T; }, timeline: { L0: L0, F: F, TF: TF } };
})();
