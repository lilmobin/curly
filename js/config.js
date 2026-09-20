/* ==========================================================================
   for Curly Lily — configuration
   Everything you are likely to change lives in this one file.
   ========================================================================== */
window.CURLY_CONFIG = {

  /* ---- YOUR ASSETS ------------------------------------------------------
     1) Drop your transparent title PNG at  assets/title.png
        (or change the path below). The site displays this image as-is —
        the title is never re-typed with HTML text.
     2) Drop your song at  assets/music.mp3  (or change the path below).
     3) Optional: assets/cover.jpg is the small album artwork. If the file is
        missing, a matching lily artwork is generated automatically.
  ------------------------------------------------------------------------ */
  title: {
    src: 'assets/title.png',
    alt: 'for Curly Lily',
    width: 0.62          // width of the VISIBLE lettering as a fraction of the screen width.
                         // The site measures your PNG and ignores its transparent margins, so
                         // this is the size you actually see (raise it for a bigger title).
                         // If you open index.html straight from disk the browser blocks that
                         // measurement; serve the folder (see README) or set
                         //   trim: { x0: 0.1, x1: 0.9, y0: 0.25, y1: 0.75 }
                         // = where the lettering sits inside the PNG, as fractions.
  },

  /* One entry = single-song experience. Add more entries and the
     previous / next / shuffle buttons start working as a playlist. */
  tracks: [
    {
      src:    'assets/music.mp3',
      title: 'Cinderella (feat. Ty Dolla $ign)',
      artist: 'Mac Miller',
      cover:  'assets/cover.jpg'
    }
  ],

  /* ---- AUDIO BEHAVIOUR -------------------------------------------------- */
  autoplay: true,                 // try to start once the final screen is ready.
                                  // If the browser blocks it, nothing breaks: the
                                  // player simply waits in "paused".
  startOnFirstInteraction: true,  // if autoplay was blocked, the first tap/click/key
                                  // anywhere starts the music.
  volume: 1,                      // 0 – 1

  /* ---- LOADING ---------------------------------------------------------- */
  loading: {
    duration: 2.8                 // seconds the loading phase lasts (2–3 s suggested).
                                  // If an asset is still not ready, the bar waits
                                  // (never past ~97 %) until it is, or until
                                  // assetTimeout expires.
  },
  assetTimeout: 8000,             // ms after page load before a slow asset is given up on

  /* ---- CINEMATIC TIMELINE (seconds from page load) ----------------------
     Loading starts at `loadStart`, the outro plays right after it finishes.
  ------------------------------------------------------------------------ */
  timing: {
    titleStart:      3.6,   // light begins to pass over the title
    titleSweepEnd:   5.0,   // title fully revealed
    dissStart:       5.6,   // title starts dissolving into particles
    dissEnd:         6.2,   // …and is gone
    panelIn:         5.8,   // glass loading panel starts to appear
    loadStart:       6.2    // loading bar / flower bloom begins
  },

  /* ---- PERFORMANCE / VISUALS ------------------------------------------- */
  maxDPR: 1.5                     // cap for canvas resolution (lower = faster on phones; the engine also lowers it by itself)
};
