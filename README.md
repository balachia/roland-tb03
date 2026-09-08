# TB-03 Lab

**Live demo:** <https://tony.vashevko.com/roland-tb03/>

TB-03 Lab is a dependency-free acid bassline instrument that runs entirely in the browser. It combines a monophonic Web Audio synth with a direct-edit 16-step sequencer, eight locally saved pattern slots, variable pattern length, swing, drive, and delay.

It is designed as a playful browser tribute, not a circuit-level recreation. There are no samples, external libraries, build tools, accounts, or network requests.

## Run it

You can open `index.html` directly in a modern browser. For the same HTTP setup used by GitHub Pages, run:

```sh
python3 -m http.server 8080
```

Then visit <http://localhost:8080>. Select **Start** (or enter a note) to permit Web Audio; browsers require that gesture before audio can begin.

## Make a pattern

1. Select one of the 16 step buttons.
2. Enter a note with the pitch keys, or choose **Rest + Next**. Note/rest entry advances automatically, so a line can be entered quickly.
3. Change the selected step's octave, accent, or slide. A slide connects to the immediately following non-rest step.
4. Set pattern length anywhere from 1–16 steps.
5. Press **Start**. Adjust the oscillator, filter, envelope, tempo, swing, drive, delay, feedback, and volume while it plays.

Pattern slots **P1–P8** and all control settings auto-save to `localStorage` in that browser. **Randomize** generates an E-minor-flavored acid line; **Clear** turns the current pattern into rests. Slot P1 begins with a useful example pattern.

### Computer keyboard

| Key | Action |
| --- | --- |
| `Space` | Start transport |
| `←` / `→` | Select previous / next step |
| `A W S E D F T G Y H U J` | Enter C through B (piano layout) |
| `R` | Enter rest |
| `X` | Toggle accent |
| `L` | Toggle slide |
| `[` / `]` | Octave down / up |
| `1`–`8` | Load a pattern slot |
| `Esc` | Stop |

Shortcuts stay inactive while a form control or button has focus, so range inputs retain their normal keyboard behavior. Each binding has one stable action.

## Sound engine

One persistent saw or square oscillator feeds a resonant low-pass filter and fast amplitude/filter envelopes, keeping the instrument genuinely monophonic. Accent strength controls how much accented steps increase level and filter-envelope depth. Slide keeps the gate open and ramps that same oscillator into the following step without retriggering its envelopes. The shared output path adds waveshaping drive, a feedback delay, dynamics protection, master volume, and a level meter.

Scheduling uses a short Web Audio look-ahead window rather than relying on animation timing. If a background tab stalls its timer, the scheduler resets its clock instead of trying to burst through a long backlog.

## Test it

The pure sequencer/music and DSP helpers use Node's built-in test runner:

```sh
npm test
```

The browser smoke test discovers Chrome or Chromium, starts an isolated local server, drives the actual page through the browser debugging protocol, rejects uncaught script errors, edits and saves a pattern, and exercises Web Audio start/stop:

```sh
npm run smoke
```

If Chrome/Chromium is not installed, the smoke script reports a skip. Set `CHROME_BIN` to a browser executable to select one explicitly. Run both checks with `npm run check`.

## Publish with GitHub Pages

1. Push this directory to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your main branch and the `/ (root)` folder, then save.

GitHub Pages can serve the project as-is; there is no build output to configure. Pattern data remains local to each visitor's browser and is never uploaded.

Architecture and future-editing notes are in [DEVELOPMENT.md](DEVELOPMENT.md).

## Browser support and scope

A current desktop or mobile browser with Web Audio, CSS custom properties, and ES2017-era JavaScript is recommended. The synth deliberately captures the broad acid-bassline workflow and character; component tolerances, exact envelopes, sequencer modes, MIDI, sync, pattern import/export, and faithful hardware circuitry are outside this version's scope.

## License and trademark note

Source code is available under the [MIT License](LICENSE).

TB-03 Lab is an independent educational and creative project. It is not affiliated with, authorized by, sponsored by, or endorsed by Roland Corporation. Roland, TB-03, and TB-303 are identifiers associated with their respective owner. This project uses no Roland logo, firmware, samples, panel artwork, or other proprietary assets.
