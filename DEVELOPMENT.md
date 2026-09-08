# Maintainer notes

This file is the short handoff for future edits. User-facing operation and
GitHub Pages setup live in [README.md](README.md).

## Published project

- Repository: <https://github.com/balachia/roland-tb03>
- Live page: <https://tony.vashevko.com/roland-tb03/>
- Pages source: `main`, repository root (`/`)
- A push to `main` republishes the static site; there is no build artifact or
  deployment branch.

## Architecture

- `index.html` is the complete semantic control surface. Keep the UTF-8 meta
  declaration near the top and preserve the script order: core, audio, app.
- `styles.css` draws the hardware-inspired panel and owns the responsive
  breakpoints at 1180, 760, and 430 pixels. There are no image assets.
- `js/core.js` contains deterministic pitch, timing, pattern-normalization,
  randomization, and slide-event logic. It exports to both CommonJS (tests) and
  `globalThis.TB03Core` (browser).
- `js/audio.js` owns one persistent monophonic oscillator, filter, and envelope.
  Its path is voice -> drive -> dry/delay -> compressor -> master/analyser.
  Slides keep that single voice gated and do not retrigger the envelopes.
- `js/app.js` owns rendering, direct step editing, the 25 ms/120 ms look-ahead
  scheduler, keyboard controls, and persistence under
  `tb03-lab-state-v1` in `localStorage`.
- `scripts/smoke.sh` and `scripts/chromium-smoke.mjs` start an isolated local
  server/profile and drive Chrome through DevTools. The smoke test boots,
  edits, saves, starts audio, switches patterns while running, and stops.

## Invariants worth preserving

1. Stay dependency-free and GitHub Pages-native unless a new requirement truly
   needs a toolchain. The current page also works when `index.html` is opened
   directly.
2. Keep each classic browser script inside its IIFE. Classic script files share
   a global lexical scope; accidental top-level declarations can otherwise stop
   the page before boot.
3. Create/resume `AudioContext` only after a user gesture. Browser autoplay
   policy is part of the design, not an incidental limitation.
4. A step's `slide` flag points from that step into the following non-rest
   step. The scheduler suppresses `slideFromPrevious` on a fresh transport
   start so a loop-closing slide cannot make the first note silent.
5. Cancelling or changing a live pattern must clear scheduled audio automation
   and playhead timers before rewinding the scheduler; otherwise two patterns
   can overlap inside the look-ahead window.
6. Treat saved state as hostile/old input. Normalize every pattern and setting,
   and bump the storage key or add migration logic for incompatible schemas.
7. Keyboard bindings have one stable action. Do not intercept shortcuts while
   an input, button, disclosure summary, or editable element has focus.
8. Zero drive is a true identity curve. Keep the regression test if the
   waveshaper changes.

## Before publishing an edit

```sh
npm run check
git diff --check
```

`npm run check` runs nine Node tests and the real Chromium interaction smoke
test. The smoke test requires Chrome/Chromium and a free loopback port. It can
also capture a responsive screenshot:

```sh
sh scripts/smoke.sh /tmp/tb03-desktop.png 1440 1000
sh scripts/smoke.sh /tmp/tb03-mobile.png 390 844
```

After pushing, inspect the Pages build and the deployed response:

```sh
gh api repos/balachia/roland-tb03/pages/builds/latest --jq '{status,commit,error}'
curl --fail --location --head https://tony.vashevko.com/roland-tb03/
```

## Current scope and natural next features

This is an acid-bassline simulation, not a circuit-accurate TB-03/TB-303 model.
The intentionally deferred areas are MIDI input/clock, pattern import/export,
tempo-synced delay divisions, pattern chaining, original-hardware programming
mode, and a more exact nonlinear filter model. Add these only when wanted; none
is required for the current instrument to function.

## Local task tracking

Chainlink lives in `.chainlink/` and is intentionally ignored by Git. Run its
commands from this project root. `chainlink init` also generated `.claude/` and
`.mcp.json`; those integration files remain untracked locally and are not part
of the published web app. Decide explicitly whether to commit or ignore them
before expecting a clean `git status`.
