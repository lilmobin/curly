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
    /* slow, readable opening: the lines enter (0.3–4.6 s) carrying haze and particles that spread and light the screen,
       then the title is revealed, then loading */
    titleStart: 3.6, titleSweepEnd: 5.0, dissStart: 5.6, dissEnd: 6.2, panelIn: 5.8, loadStart: 6.2
  };
  var k;
  for (k in (CFG.timing || {})) TM[k] = CFG.timing[k];
  var DUR = Math.max(.6, (CFG.loading && CFG.loading.duration) || 2.8);
  var L0 = TM.loadStart, F = L0 + DUR;                                   // loading start / finish
  /* at the exact moment loading reaches 100 %: the lily bursts, the glass card turns into the player and the lily's leftovers are cleared — all on one clock */
  var OUT = { pulse: .22, dissStart: 0, dissEnd: .38, morph: 0, titleIn: .4, titleDur: 1.0, autoplay: .9, finalStart: .05, finalEnd: 1.1, kill: .5 };
  var TF = F + OUT.titleIn;                                              // final title reveal

  function kf(t, a) {
    if (t <= a[0][0]) return a[0][1];
    for (var i = 1; i < a.length; i++) {
      if (t <= a[i][0]) { var u = (t - a[i - 1][0]) / (a[i][0] - a[i - 1][0]); u = u * u * (3 - 2 * u); return a[i - 1][1] + (a[i][1] - a[i - 1][1]) * u; }
    }
    return a[a.length - 1][1];
  }
  var KF = {
    /* target darkness once the haze has reached a place (the screen does NOT lift by itself — only the spreading haze lights it) */
    dark:     [[0, .16], [L0 + .8, .18], [L0 + 1.8, .30], [F, .20], [F + .4, .10], [F + 1.1, 0]],
    lightCap: [[0, .55], [3.0, .60], [5.5, .85], [7.0, 1]],    // how thick the haze has become (1 = full colour); the field is uniform from here on
    reach:    [[0, .10], [3.0, .4], [6.5, 1]],                 // drives the colour of the lines
    heat:     [[.6, 0], [3.0, .3], [5.5, .5], [F - 1, .55], [F, .6], [F + 1.1, 1]],   // coral-red → pink → (finally) the original white
    atmos:    [[0, 0], [3.4, 0], [4.4, .10], [5.6, .12], [L0, .06], [F, .03], [F + .5, 0]],
    vignette: [[0, 0], [5.0, 0], [6.5, .2], [8.0, .14], [F + .5, .10], [F + 1.1, 0]],
    wisp:     [[0, .15], [3.0, .4], [5.6, .9], [L0 + 1.6, .5], [F, .55], [F + .9, 0]],
    titleGlow:[[3.0, 0], [4.2, .20], [5.2, .22], [5.8, .08], [F + .4, .05], [F + 1.1, 0]],
    trailS:   [[0, 0], [.3, .95], [4.6, .9], [5.6, .12], [6.2, 0]],        // opening lines fade once the title has been revealed
    trailL:   [[L0 - .2, 0], [L0 + .6, 1], [F, 1], [F + .5, 0]],           // strands converging on the node while loading
    dust:     [[0, 0], [5.0, 0], [6.6, .85], [F, .55], [F + .4, 0]],       // the baked star dust joins when the haze has covered the screen
    micro:    [[0, .6], [3.0, .7], [6.0, .75], [F, .8], [F + 1.1, .5]],
    glitter:  [[0, .6], [3.0, .8], [F + 1.1, .85]],
    star:     [[.3, .4], [2.0, .9], [4.0, 1], [L0, .8], [F + 1.1, .3]],
    dens:     [[0, 1.7], [5.0, 1.7], [6.5, 1], [F + .3, 1], [F + 1.2, .72]],
    leaf:     [[L0 + .3, 0], [L0 + 1.4, .6], [F, .65], [F + .4, 0]]
  };
  function progEase(u) { var s = u * u * (3 - 2 * u); return u * .4 + s * .6; }
  function pOf(T) { return T < L0 ? 0 : progEase(clamp((T - L0) / DUR)); }

  /* -------------------------------------------------------------- DOM */
  var body = document.body;
  var el = {
    canvas: $('fx'), title: $('title'), titleImg: $('titleImg'), titleGlow: $('titleGlow'), titleSheen: $('titleSheen'), orb: $('orb'),
    titleFx: $('titleFx'), dustWrap: $('dustWrap'), card: $('card'), loadingUI: $('loadingUI'), loadTrack: $('loadTrack'), loadFill: $('loadFill'), loadDot: $('loadDot')
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
  var TC = CFG.title || {};
  var trim = { x0: 0, x1: 1, y0: 0, y1: 1 };            // visible lettering inside the PNG, as fractions
  if (TC.trim) { for (k in TC.trim) trim[k] = TC.trim[k]; }
  function measureTrim(img) {
    if (TC.trim) return;
    try {
      var cw = 480, ch = Math.max(8, Math.round(cw * img.naturalHeight / img.naturalWidth));
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var x = c.getContext('2d'); x.drawImage(img, 0, 0, cw, ch);
      var d = x.getImageData(0, 0, cw, ch).data, x0 = cw, x1 = -1, y0 = ch, y1 = -1, i, j;
      for (j = 0; j < ch; j++) for (i = 0; i < cw; i++) if (d[(j * cw + i) * 4 + 3] > 60) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
      if (x1 > x0 && y1 > y0) trim = { x0: x0 / cw, x1: (x1 + 1) / cw, y0: y0 / ch, y1: (y1 + 1) / ch };
    } catch (e) {
      /* opened straight from disk (file://): browsers forbid reading pixels. Assume the usual transparent margin. */
      var f = clamp(TC.fallbackFill || .8, .3, 1);
      trim = { x0: (1 - f) / 2, x1: 1 - (1 - f) / 2, y0: .2, y1: .8 };
    }
  }
  el.titleImg.addEventListener('load', function () {
    if (el.titleImg.naturalWidth) { titleAspect = el.titleImg.naturalHeight / el.titleImg.naturalWidth; measureTrim(el.titleImg); }
    assetDone('title'); layout();
  });
  el.titleImg.addEventListener('error', function () {
    titleMissing = true; assetDone('title'); el.title.style.display = 'none';
    if (window.console) console.warn('[for Curly Lily] Title image not found: ' + (CFG.title && CFG.title.src) + ' — put your transparent PNG there (see js/config.js).');
  });
  var tsrc = (CFG.title && CFG.title.src) || 'assets/title.png';
  el.titleImg.alt = (CFG.title && CFG.title.alt) || 'for Curly Lily';
  el.titleImg.src = tsrc; el.titleGlow.src = tsrc;
  try {                                               // the light band needs a CSS mask → only for same-origin http(s) images
    var tu = new URL(tsrc, location.href);
    if (/^https?:$/.test(location.protocol) && tu.origin === location.origin) {
      document.documentElement.style.setProperty('--title-url', 'url("' + tu.href + '")');
      el.titleSheen.hidden = false;
    }
  } catch (e) { /* no sheen */ }

  /* ------------------------------------------------------------ engine */
  var fx = window.CL.createFX(el.canvas, {
    maxDPR: CFG.maxDPR || 1.5, reduced: reduced, lockLevel: q.has('level') ? parseInt(q.get('level'), 10) : undefined, dustA: $('dustA'), dustB: $('dustB'),
    /* if the device struggles the engine steps down; from level 2 the CSS glass drops its live blur too */
    onLevel: function (l) { body.classList.toggle('lite', l >= 2); }
  });
  var player = window.CL.createPlayer(CFG, {
    onCover: function () { assetDone('cover'); },
    onAudioReady: function () { assetDone('audio'); },
    onHeart: function (x, y) { fx.emit(x, y, 14, 46, 1.4); }
  });

  /* ------------------------------------------------------------ layout */
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);

  /* ------------------------------------------------ title: baked canvases for the opening reveal
     The reveal (light sweep, blur-in, bloom) used to animate CSS masks and filters on a large PNG every
     frame, which is very expensive on phones. Now the title is baked once at its display size and the
     reveal only recombines a few small bitmaps. */
  var tcv = $('titleCv'), tctx = tcv.getContext('2d'), tBake = null;
  function tmpCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function bakeTitle() {
    var img = el.titleImg;
    if (titleMissing || !img.complete || !img.naturalWidth || !G.imgW) return;
    var dd = Math.min(window.devicePixelRatio || 1, 1.5), u = clamp(G.imgW / 300, .9, 1.04), iw = G.imgW, ih = iw * titleAspect;
    var cw = Math.round(1.2 * iw * dd), ch = Math.round((ih + .18 * iw) * dd), ox = .1 * iw * dd, oy = .09 * iw * dd, W_ = iw * dd, H_ = ih * dd;
    var sharp = tmpCanvas(cw, ch), sx = sharp.getContext('2d');
    sx.imageSmoothingQuality = 'high';
    function glowPass(color, blur) {                         // draw only the shadow (the image itself is thrown off-canvas)
      sx.save(); sx.shadowColor = color; sx.shadowBlur = blur * dd; sx.shadowOffsetX = 20000; sx.drawImage(img, ox - 20000, oy, W_, H_); sx.restore();
    }
    glowPass('rgba(255,60,100,.45)', 18 * u); glowPass('rgba(255,104,132,.7)', 7 * u); glowPass('rgba(255,238,240,.9)', 2 * u);
    sx.drawImage(img, ox, oy, W_, H_);
    function blurred(div) {                                   // cheap blur: shrink, then stretch back
      var t = tmpCanvas(Math.max(8, cw / div | 0), Math.max(8, ch / div | 0)), o = tmpCanvas(cw, ch), ox_ = o.getContext('2d');
      t.getContext('2d').drawImage(sharp, 0, 0, t.width, t.height); ox_.imageSmoothingEnabled = true; ox_.drawImage(t, 0, 0, cw, ch); return o;
    }
    var soft = blurred(6), bloom = blurred(11), bx = bloom.getContext('2d');
    bx.globalCompositeOperation = 'lighter'; bx.drawImage(bloom, 0, 0);
    tcv.width = cw; tcv.height = ch;
    tBake = { sharp: sharp, soft: soft, bloom: bloom, cw: cw, ch: ch };
  }
  function paintTitle(ts) {
    var b = tBake; if (!b) return;
    tctx.globalCompositeOperation = 'source-over'; tctx.globalAlpha = 1; tctx.clearRect(0, 0, b.cw, b.ch);
    if (ts.o < .003) return;
    var bl = clamp(ts.b / 8);
    tctx.globalAlpha = ts.o * (1 - bl); tctx.drawImage(b.sharp, 0, 0);
    if (bl > .01) { tctx.globalAlpha = ts.o * bl; tctx.drawImage(b.soft, 0, 0); }
    if (ts.g > .01) { tctx.globalCompositeOperation = 'lighter'; tctx.globalAlpha = Math.min(1, ts.g * .6 * ts.o); tctx.drawImage(b.bloom, 0, 0); }
    if (ts.r < .999) {                                          // the light that passes over the lettering
      var fxp = b.cw * (1.1895 - 2 * lerp(.65, .04, ts.r)), e = .11 * b.cw, g = tctx.createLinearGradient(fxp - e, 0, fxp + e, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      tctx.globalCompositeOperation = 'destination-in'; tctx.globalAlpha = 1; tctx.fillStyle = g; tctx.fillRect(0, 0, b.cw, b.ch);
    }
    tctx.globalCompositeOperation = 'source-over'; tctx.globalAlpha = 1;
  }

  var G = { vw: 390, vh: 844, cx: 195, boxCX: 195, imgW: 312, glyphCY: 380, glyphW: 240, glyphH: 110 };
  var trackW = 0;
  if (window.ResizeObserver) new ResizeObserver(function () { trackW = el.loadTrack.clientWidth; }).observe(el.loadTrack);

  function layout() {
    var root = document.documentElement, cs = getComputedStyle(probe);
    var vw = root.clientWidth || window.innerWidth, vh = window.innerHeight;
    var safeTop = parseFloat(cs.paddingTop) || 0, safeBot = parseFloat(cs.paddingBottom) || 0;
    var usable = vh - safeTop - safeBot;

    var S = Math.min(vw, 460, vh * .56);                       // composition unit (phone: full width; desktop: compact)
    var u = clamp(S / 390, .9, 1.04);

    /* player: compact glass card, sitting low on the page (final reference) */
    var cardW = Math.min(Math.max(.64 * S, 246), vw - 32), cardH = clamp(.52 * cardW, 124, 140);
    var playerCY = safeTop + usable * .665;
    /* loading panel keeps its earlier place; the card glides down when it turns into the player */
    var loadW = Math.min(Math.max(.75 * S, 250), vw - 32), loadH = 124 * u;
    var loadCY = safeTop + usable * .55;

    /* title: size the visible lettering, not the PNG's transparent margin */
    var gw = Math.max(.05, trim.x1 - trim.x0), gh = Math.max(.05, trim.y1 - trim.y0);
    var imgW = (TC.width || .62) * S / gw, imgH = imgW * (titleMissing ? .42 : titleAspect);
    var maxGlyphH = .27 * usable;
    if (gh * imgH > maxGlyphH) { var kk = maxGlyphH / (gh * imgH); imgW *= kk; imgH *= kk; }
    var glyphW = gw * imgW, glyphH = gh * imgH;
    var glyphCY = safeTop + usable * .445;
    glyphCY = Math.min(glyphCY, playerCY - cardH / 2 - 12 - glyphH / 2);
    glyphCY = Math.max(glyphCY, safeTop + glyphH / 2 + 6);
    var gcx = (trim.x0 + trim.x1) / 2, gcy = (trim.y0 + trim.y1) / 2;
    var dx = (.5 - gcx) * imgW, imgCY = glyphCY + (.5 - gcy) * imgH;

    var st = root.style;
    st.setProperty('--u', u.toFixed(3)); st.setProperty('--title-ar', (titleMissing ? .42 : titleAspect).toFixed(4));
    st.setProperty('--title-w', imgW.toFixed(1) + 'px'); st.setProperty('--title-cy', imgCY.toFixed(1) + 'px'); st.setProperty('--title-dx', dx.toFixed(1) + 'px');
    st.setProperty('--gl', (vw / 2 - glyphW / 2).toFixed(1) + 'px'); st.setProperty('--gt', (glyphCY - glyphH / 2).toFixed(1) + 'px');
    st.setProperty('--gw', glyphW.toFixed(1) + 'px'); st.setProperty('--gh', glyphH.toFixed(1) + 'px');
    st.setProperty('--card-cy', loadCY.toFixed(1) + 'px'); st.setProperty('--player-cy', playerCY.toFixed(1) + 'px');
    st.setProperty('--card-w', cardW.toFixed(1) + 'px'); st.setProperty('--card-h', cardH.toFixed(1) + 'px');
    st.setProperty('--load-w', loadW.toFixed(1) + 'px'); st.setProperty('--load-h', loadH.toFixed(1) + 'px');

    G = { vw: vw, vh: vh, cx: vw / 2, boxCX: vw / 2 + dx, imgW: imgW, glyphCY: glyphCY, glyphW: glyphW, glyphH: glyphH };
    fx.resize(vw, vh, {
      S: S,
      flower: { bx: vw / 2, by: loadCY - loadH / 2 + .14 * loadH, L: .42 * S },
      title: { cx: vw / 2, cy: glyphCY, w: glyphW, h: glyphH },
      center: { x: vw / 2, y: (glyphCY + loadCY) / 2, rx: Math.min(.46 * vw, .95 * S), ry: Math.min(.19 * vh, .62 * S) }
    });
    trackW = el.loadTrack.clientWidth; player.measure();
    bakeTitle();
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
  if (reduced) T = Math.max(T, F + 1.6);                  // skip the cinematic sequence, just fade in calmly
  var time = 0, titleHold = 0, stage = '', flags = { flare3: T > F + 1.3, node: T > L0 + .4, autoplay: T > F + OUT.autoplay };
  /* starbursts of the opening appear at the moment the spreading haze reaches them: [x, y, size, life] */
  var FLARE_DEFS = [[.63, .17, 118, 6], [.57, .545, 84, 6], [.30, .262, 46, 5.5], [.81, .745, 104, 6], [.17, .655, 40, 5.5], [.32, .25, 58, 5], [.77, .43, 52, 5], [.16, .72, 48, 5], [.45, .90, 60, 5], [.86, .18, 50, 5]];
  var FLARES = FLARE_DEFS.map(function (d) { return [Math.max(.5, fx.arrivalAt(d[0], d[1]) + .15), d[0], d[1], d[2], d[3]]; }).sort(function (a, b) { return a[0] - b[0]; });
  var flareI = 0;
  while (flareI < FLARES.length && FLARES[flareI][0] <= T) flareI++;

  mq.addEventListener && mq.addEventListener('change', function (e) {
    reduced = e.matches; fx.setReduced(reduced);
    if (reduced) T = Math.max(T, F + 1.6);
  });

  /* title: opacity / blur / glow / light-sweep for a given moment */
  var TS = { r: 0, o: 0, b: 0, g: 0, s: 1 };
  function reveal(t, t0, dur, blur0, peak, simple) {
    var u = clamp((t - t0) / dur);
    TS.r = (reduced || simple) ? 1 : easeInOutCubic(u);
    TS.o = smooth(0, 1, u);
    TS.b = (reduced || simple) ? 0 : blur0 * (1 - easeOutCubic(clamp((t - t0) / (dur * 1.25))));
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
    else reveal(t, TF, OUT.titleDur, 6, .55, true);       // final arrival: opacity + glow only (no per-frame filters)
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
    var prog = pOf(T), ts = titleAt(T), tt = G.imgW * 1.2;

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
    var tone = T < TM.dissEnd ? 'coral' : 'white', mode = (T < TM.dissEnd && tBake && !reduced) ? 'cv' : 'img';
    if (tone !== el.title.__tone) { el.title.__tone = tone; el.title.setAttribute('data-tone', tone); }
    if (mode !== el.title.__mode) { el.title.__mode = mode; el.title.setAttribute('data-mode', mode); }
    if (!titleMissing && mode === 'cv') {
      setStyle(el.title, 'opacity', '1');
      if (el.title.__m) { el.title.__m = false; el.title.classList.remove('masked'); }
      setVar(el.title, '--ts', ts.s.toFixed(4));
      paintTitle(ts);
    } else if (!titleMissing) {
      var settled = T >= TF + OUT.titleDur + .2;                       // the shimmer only plays once the title has fully arrived
      if (settled !== el.title.__st) { el.title.__st = settled; el.title.classList.toggle('settled', settled); el.titleFx.classList.toggle('on', settled && !reduced); }
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
      oa = smooth(.12, .25, ou) * (1 - smooth(.85, 1, ou)) * .85;
      var r = easeInOutCubic(ou), pos = lerp(.65, .04, r);
      var ox = G.boxCX - tt / 2 + tt * (1.1895 - 2 * pos);
      var oy = G.glyphCY + Math.sin(r * TAU * 1.6) * .13 * G.glyphH - .03 * G.glyphH;
      el.orb.style.transform = 'translate3d(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px,0)';
      orbAcc += dt * 46 * oa;
      var n = Math.floor(orbAcc); if (n > 0) { orbAcc -= n; fx.emit(ox, oy, n, 22, 1.5); }
    }
    setStyle(el.orb, 'opacity', oa.toFixed(3));

    /* ---- scripted sparkle moments ---- */
    if (!reduced) {
      while (flareI < FLARES.length && T >= FLARES[flareI][0]) { var fl = FLARES[flareI++]; fx.flare(fl[1], fl[2], fl[3], fl[4], .25); }
      if (!flags.node && T > L0 + .4) { flags.node = true; fx.flare(.62, .665, 120, Math.max(1.5, F - L0 - .2)); }
      if (!flags.flare3 && T > F + 1.3) { flags.flare3 = true; fx.flare(.78, .1, 40, 4.5); }
    }

    /* ---- autoplay: once, silently ---- */
    if (!flags.autoplay && T > F + OUT.autoplay) { flags.autoplay = true; player.tryAutoplay(); }

    /* ---- params for the canvas ---- */
    P.dt = dt; P.rawDt = rawDt; P.time = time; P.T = T; P.reduced = reduced; P.motion = reduced ? .12 : 1;
    P.blackout = false;                                               // the haze is there from the very first frame
    P.fadeIn = smooth(0, reduced ? .9 : .5, time);
    P.dark = kf(T, KF.dark); P.reach = kf(T, KF.reach); P.heat = kf(T, KF.heat); P.atmos = reduced ? 0 : kf(T, KF.atmos);
    P.vignette = kf(T, KF.vignette); P.wisp = reduced ? .03 : kf(T, KF.wisp);
    P.titleGlow = kf(T, KF.titleGlow); P.trailS = reduced ? 0 : kf(T, KF.trailS); P.trailL = reduced ? 0 : kf(T, KF.trailL); P.L0 = L0;
    P.micro = kf(T, KF.micro); P.glitter = kf(T, KF.glitter); P.starRate = kf(T, KF.star);
    P.leafA = reduced ? 0 : kf(T, KF.leaf); P.dens = kf(T, KF.dens); P.lightCap = reduced ? 1 : kf(T, KF.lightCap);
    setStyle(el.dustWrap, 'opacity', (reduced ? Math.min(.6, kf(T, KF.dust)) : kf(T, KF.dust)).toFixed(3));
    P.flowerP = reduced ? 0 : prog;
    P.bloomPulse = (reduced || T < F) ? 0 : Math.sin(Math.PI * clamp((T - F) / OUT.pulse));
    /* ease-OUT: the burst is at full speed at the very first moment after loading completes */
    P.flowerDissolve = reduced ? 0 : 1 - Math.pow(1 - clamp((T - F - OUT.dissStart) / (OUT.dissEnd - OUT.dissStart)), 2.2);
    P.residual = 0;                                                    // nothing of the lily remains once it has dissolved
    P.finalMix = smooth(F + OUT.finalStart, F + OUT.finalEnd, T);       // the last frame's flat pink field
    P.dustKill = smooth(F + OUT.kill, F + OUT.kill + .3, T);            // every flower particle is gone
    P.starCap = Math.round(lerp(15, 6, smooth(F, F + 1.1, T)));
    P.starScale = lerp(1, .5, smooth(F + .2, F + 1.1, T));               // the last frame has small, soft sparkles only
    P.titleDissolve = smooth(TM.dissStart, TM.dissEnd, T);
    /* once the last frame is reached nothing moves fast → paint the canvas at half rate */
    var idle = T > F + OUT.finalEnd + .6;
    fxAcc += dt; fxRaw = rawDt;
    if (!idle || (frameN & 1) === 0) { var t0 = performance.now(); P.dt = Math.min(fxAcc, .066); P.rawDt = fxRaw; P.idle = idle; fx.frame(P); fxAcc = 0; fxMs += (performance.now() - t0 - fxMs) * .05; }
    player.tick();
  }

  var last = 0, frameN = 0, fxAcc = 0, fxRaw = 0, fxMs = 0;
  function loop(now) {
    requestAnimationFrame(loop); frameN++;
    if (!last) last = now;
    var raw = (now - last) / 1000; last = now;
    if (raw > .5) raw = .016;                               // tab was in the background
    /* the timeline follows the real clock (frames may be dropped, but the burst, the card and the player can never drift apart) */
    var dtT = Math.min(raw, .25), dt = Math.min(raw, .05);
    time += dtT; step(dtT); render(dt, raw);
  }
  requestAnimationFrame(loop);

  /* handy for debugging / your own tweaks in the console */
  window.CL.debug = { get T() { return T; }, timeline: { L0: L0, F: F, TF: TF }, buildMs: function () { return fx.buildMs(); }, cover: function () { return fx.coverTime(); }, arrival: function (x, y) { return fx.arrivalAt(x, y); }, level: function () { return fx.level(); }, frameMs: function () { return fxMs; } };
})();
