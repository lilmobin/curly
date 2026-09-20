# for Curly Lily

A single-screen, cinematic music website. Plain HTML / CSS / JavaScript — no build step, no dependencies.

## Put your files here

| File | What it is |
|---|---|
| `assets/title.png` | **Your transparent title PNG.** Shown exactly as supplied (never re-typed as text). |
| `assets/music.mp3` | **Your song.** Duration, time and progress come from the real audio. |
| `assets/cover.jpg` | Optional square album art (a matching lily is generated if missing). |

The three files currently in `assets/` are **placeholders** so you can preview the layout — overwrite them.
Different names or paths? Change them in `js/config.js`. Song title / artist are also set there.

## Run it

Open `index.html` directly, or serve the folder (recommended):

    python3 -m http.server 8000     # then visit http://localhost:8000

Upload the whole folder to any static host (Netlify, Vercel, GitHub Pages, your own server).
The host must support HTTP range requests for seeking in the song — all normal hosts do.

## Tweaking (all in `js/config.js`)

- `loading.duration` — length of the loading phase (default 2.8 s). The bar waits, never past ~97 %, if an asset is genuinely still loading.
- `timing.*` — when the title is revealed / dissolves and when loading starts.
- `autoplay`, `startOnFirstInteraction` — the browser may block autoplay; if so the player simply waits in "paused" and the first tap/key starts the music.
- `residualFlower` — how much faint floral glow stays behind the title (0 = none, default 0.05).
- `maxDPR` — lower (e.g. 1.5) for extra smoothness on weak phones.
- Add more objects to `tracks` and previous / next / shuffle become a real playlist.

## How it is built

- `js/main.js` — one master timeline `T` (intro → title reveal → loading → outro → calm) plus layout and the loading gate.
- `js/fx.js` — one `<canvas>`: haze, dust, glitter, four-point sparkles, light trails, the lily. The lily's petals are drawn from the *loading progress itself*, so bar and bloom can never drift apart.
- `js/player.js` — HTML5 audio, click / drag / keyboard seeking, heart (remembered in localStorage).
- `css/style.css` — layout tokens, glass card, player.

The scene starts as pure `#000` (nothing drawn at all), red lines enter, the pink atmosphere expands from the centre, and the lines turn white only where and when that light reaches them. There is no grain or texture layer; the final background colours were sampled from your reference image.

Adaptive quality lowers particle counts automatically if a device drops frames. `prefers-reduced-motion` skips the cinematic sequence, freezes most motion and just fades the final screen in.

## Debug URL parameters

`?t=8.5` start at a moment · `?freeze` stop the timeline · `?speed=3` play faster
