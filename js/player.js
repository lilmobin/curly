/* ==========================================================================
   player.js — real audio, real progress
   • progress bar / times come from the <audio> element itself (read every frame)
   • click / tap / drag / arrow-keys on the bar seek
   • autoplay is attempted once and fails silently if the browser blocks it
   ========================================================================== */
(function (global) {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* generated lily artwork, used when a track has no (or a broken) cover image */
  function makeCover() {
    var c = document.createElement('canvas'); c.width = c.height = 160;
    var x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 160, 160);
    g.addColorStop(0, '#F2B8C2'); g.addColorStop(1, '#9C4A61'); x.fillStyle = g; x.fillRect(0, 0, 160, 160);
    var rg = x.createRadialGradient(80, 100, 4, 80, 100, 84);
    rg.addColorStop(0, 'rgba(255,240,244,.85)'); rg.addColorStop(1, 'rgba(255,240,244,0)'); x.fillStyle = rg; x.fillRect(0, 0, 160, 160);
    [[-60, 84, 18, .16], [60, 84, 18, .16], [0, 112, 17, .14], [-30, 96, 19, .24], [30, 96, 19, .24], [0, 74, 15, .32]].forEach(function (p) {
      x.save(); x.translate(80, 128); x.rotate(p[0] * Math.PI / 180);
      x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(-p[2] * 1.5, -p[1] * .5, 0, -p[1]); x.quadraticCurveTo(p[2] * 1.5, -p[1] * .5, 0, 0);
      x.fillStyle = 'rgba(255,255,255,' + p[3] + ')'; x.fill(); x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 1.2; x.stroke(); x.restore();
    });
    return c.toDataURL('image/jpeg', .9);
  }

  function create(cfg, hooks) {
    hooks = hooks || {};
    var audio = $('audio'), ui = $('playerUI');
    var els = {
      art: $('art'), title: $('songTitle'), artist: $('songArtist'), heart: $('heartBtn'),
      seek: $('seek'), track: $('seekTrack'), fill: $('seekFill'), knob: $('seekKnob'),
      cur: $('tCur'), dur: $('tDur'),
      shuffle: $('shuffleBtn'), prev: $('prevBtn'), play: $('playBtn'), next: $('nextBtn'), repeat: $('repeatBtn')
    };
    var tracks = (cfg.tracks && cfg.tracks.length) ? cfg.tracks : [{ src: 'assets/music.mp3', title: 'Untitled', artist: '' }];
    var index = 0, shuffle = false, repeat = false, seeking = false, seekPr = 0;
    var seekW = 0, lastPr = -1, lastSec = -1, userPaused = false, armed = false, audioFailed = false, fallbackCover = null;

    audio.volume = clamp(cfg.volume === undefined ? 1 : cfg.volume, 0, 1);

    /* ---- geometry (for the knob) ---- */
    function measure() { seekW = els.track.getBoundingClientRect().width || els.track.offsetWidth || 0; }
    if (global.ResizeObserver) new ResizeObserver(measure).observe(els.track);
    global.addEventListener('resize', measure);

    /* ---- helpers ---- */
    function duration() { var d = audio.duration; return (isFinite(d) && d > 0) ? d : 0; }
    function setProgressVisual(pr) {
      els.fill.style.transform = 'scaleX(' + pr.toFixed(5) + ')';
      els.knob.style.transform = 'translateX(' + (pr * seekW).toFixed(2) + 'px)';
    }
    function liveKey() { return 'curlylily:liked:' + tracks[index].src; }
    function readLiked() { try { return localStorage.getItem(liveKey()) === '1'; } catch (e) { return false; } }
    function writeLiked(v) { try { if (v) localStorage.setItem(liveKey(), '1'); else localStorage.removeItem(liveKey()); } catch (e) { /* private mode */ } }

    function setCover(src) {
      els.art.onerror = function () {
        els.art.onerror = null;
        if (!fallbackCover) fallbackCover = makeCover();
        els.art.src = fallbackCover;
        if (hooks.onCover) hooks.onCover();
      };
      els.art.onload = function () { if (hooks.onCover) hooks.onCover(); };
      if (!src) { els.art.onerror(); return; }
      els.art.src = src;
    }

    function updateMediaSession() {
      if (!('mediaSession' in navigator) || !global.MediaMetadata) return;
      var t = tracks[index];
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || '', artist: t.artist || '', artwork: t.cover ? [{ src: t.cover }] : [] });
        navigator.mediaSession.setActionHandler('play', function () { play(); });
        navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
        navigator.mediaSession.setActionHandler('previoustrack', prev);
        navigator.mediaSession.setActionHandler('nexttrack', next);
      } catch (e) { /* not supported */ }
    }

    /* ---- track loading ---- */
    function loadTrack(i, autoplay) {
      index = (i + tracks.length) % tracks.length;
      var t = tracks[index];
      audioFailed = false; lastPr = -1; lastSec = -1;
      els.title.textContent = t.title || 'Untitled';
      els.artist.textContent = t.artist || '';
      setCover(t.cover);
      var liked = readLiked();
      els.heart.setAttribute('aria-pressed', liked ? 'true' : 'false');
      audio.src = t.src;
      audio.loop = repeat;
      audio.load();
      els.dur.textContent = '0:00'; els.cur.textContent = '0:00'; setProgressVisual(0);
      updateMediaSession();
      if (autoplay) play();
    }

    /* ---- transport ---- */
    function play() {
      var pr;
      try { pr = audio.play(); } catch (e) { return Promise.resolve(false); }
      if (pr && pr.then) {
        return pr.then(function () { return true; }).catch(function (err) {
          if (err && err.name === 'NotAllowedError') return false;      // autoplay blocked — silent
          if (err && err.name === 'AbortError') return false;           // interrupted by a new load — silent
          audioFailed = true; return false;
        });
      }
      return Promise.resolve(true);
    }
    function toggle() {
      if (audio.paused) {
        userPaused = false;
        play().then(function (ok) {
          if (!ok && audioFailed) { els.play.classList.remove('shake'); void els.play.offsetWidth; els.play.classList.add('shake'); }
        });
      } else { userPaused = true; audio.pause(); }
    }
    function prev() {
      if (tracks.length > 1 && audio.currentTime < 3) { loadTrack(shuffle ? Math.floor(Math.random() * tracks.length) : index - 1, !audio.paused); return; }
      if (duration()) audio.currentTime = 0;                 // single song: restart
    }
    function next() {
      if (tracks.length > 1) { loadTrack(shuffle ? Math.floor(Math.random() * tracks.length) : index + 1, !audio.paused); return; }
      els.next.classList.remove('nudge'); void els.next.offsetWidth; els.next.classList.add('nudge');   // one song: a harmless nudge
    }

    /* ---- events from the audio element ---- */
    function syncPlaying() { ui.classList.toggle('is-playing', !audio.paused && !audio.ended); els.play.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause'); }
    audio.addEventListener('play', syncPlaying);
    audio.addEventListener('pause', syncPlaying);
    audio.addEventListener('ended', function () {
      syncPlaying();
      if (tracks.length > 1 && !repeat) loadTrack(shuffle ? Math.floor(Math.random() * tracks.length) : index + 1, true);
      else { try { audio.currentTime = 0; } catch (e) { /* ignore */ } }
    });
    function onMeta() {
      var d = duration();
      els.dur.textContent = fmt(d);
      els.seek.setAttribute('aria-valuemax', String(Math.round(d)));
      if (hooks.onAudioReady) hooks.onAudioReady(true);
    }
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', function () { if (duration()) els.dur.textContent = fmt(duration()); });
    audio.addEventListener('error', function () {
      audioFailed = true;
      if (global.console) console.warn('[for Curly Lily] Could not load audio: ' + tracks[index].src + ' — put your song at that path (see js/config.js).');
      if (hooks.onAudioReady) hooks.onAudioReady(false);
    });

    /* ---- seeking ---- */
    function prFromEvent(e) {
      var r = els.track.getBoundingClientRect();
      return clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
    }
    function showSeek(pr) { setProgressVisual(pr); els.cur.textContent = fmt(pr * duration()); }
    els.seek.addEventListener('pointerdown', function (e) {
      if (!duration()) return;
      measure(); seeking = true; els.seek.classList.add('dragging');
      try { els.seek.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      seekPr = prFromEvent(e); showSeek(seekPr);
    });
    els.seek.addEventListener('pointermove', function (e) { if (!seeking) return; seekPr = prFromEvent(e); showSeek(seekPr); });
    function endSeek(e, commit) {
      if (!seeking) return;
      seeking = false; els.seek.classList.remove('dragging');
      if (commit) { seekPr = prFromEvent(e); try { audio.currentTime = seekPr * duration(); } catch (err) { /* ignore */ } }
      lastPr = -1;
    }
    els.seek.addEventListener('pointerup', function (e) { endSeek(e, true); });
    els.seek.addEventListener('pointercancel', function (e) { endSeek(e, false); });
    els.seek.addEventListener('keydown', function (e) {
      var d = duration(); if (!d) return;
      var t = audio.currentTime, handled = true;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t += 5;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t -= 5;
      else if (e.key === 'Home') t = 0;
      else if (e.key === 'End') t = d - .1;
      else handled = false;
      if (handled) { e.preventDefault(); audio.currentTime = clamp(t, 0, d); }
    });

    /* ---- buttons ---- */
    els.play.addEventListener('click', toggle);
    els.prev.addEventListener('click', prev);
    els.next.addEventListener('click', next);
    els.shuffle.addEventListener('click', function () { shuffle = !shuffle; els.shuffle.setAttribute('aria-pressed', shuffle ? 'true' : 'false'); });
    els.repeat.addEventListener('click', function () { repeat = !repeat; audio.loop = repeat; els.repeat.setAttribute('aria-pressed', repeat ? 'true' : 'false'); });
    els.heart.addEventListener('click', function () {
      var on = els.heart.getAttribute('aria-pressed') !== 'true';
      els.heart.setAttribute('aria-pressed', on ? 'true' : 'false'); writeLiked(on);
      els.heart.classList.remove('pop'); void els.heart.offsetWidth; els.heart.classList.add('pop');
      if (on && hooks.onHeart) { var r = els.heart.getBoundingClientRect(); hooks.onHeart(r.left + r.width / 2, r.top + r.height / 2); }
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === ' ' || e.key === 'k') && (e.target === document.body || e.target === document.documentElement) && ui.parentNode.getAttribute('data-stage') === 'player') {
        e.preventDefault(); toggle();
      }
    });

    /* ---- called every frame by main.js: REAL playback position ---- */
    function tick() {
      if (seeking) return;
      var d = duration(), c = audio.currentTime || 0, pr = d ? clamp(c / d, 0, 1) : 0;
      if (Math.abs(pr - lastPr) > .00015) {
        lastPr = pr; setProgressVisual(pr);
        var s = Math.floor(c);
        if (s !== lastSec) {
          lastSec = s; els.cur.textContent = fmt(c);
          els.seek.setAttribute('aria-valuenow', String(s)); els.seek.setAttribute('aria-valuetext', fmt(c) + ' of ' + fmt(d));
        }
      }
    }

    /* ---- autoplay: try once, never complain ---- */
    function tryAutoplay() {
      if (!cfg.autoplay || !audio.paused) return Promise.resolve(!audio.paused);
      return play().then(function (ok) { if (!ok) armFirstInteraction(); return ok; });
    }
    function armFirstInteraction() {
      if (!cfg.startOnFirstInteraction || armed) return;
      armed = true;
      function off() { document.removeEventListener('click', h, true); document.removeEventListener('keydown', h, true); }
      function h(e) {
        if (!audio.paused || userPaused) { off(); return; }
        if (e.target && e.target.closest && e.target.closest('#playBtn')) { off(); return; }   // the button handles itself
        off(); play();
      }
      document.addEventListener('click', h, true);
      document.addEventListener('keydown', h, true);
    }

    loadTrack(0, false);
    measure();

    return { tick: tick, tryAutoplay: tryAutoplay, measure: measure, audio: audio };
  }

  global.CL = global.CL || {};
  global.CL.createPlayer = create;
})(window);
