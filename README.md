# tiny-wasm

A WebAssembly build of [TINY 2.1](https://github.com/WollyMonjac/Tiny-2.1), a transformer for DOS
written in Turbo C 2.0. Live at <https://tiny.gottz.de/>.

`upstream/TINY.C` is compiled **unchanged** (`-D__TURBOC__`, so it takes its DOS full-screen
path). What Turbo C and the PC used to provide comes from `shim/`:

| Part | Replacement |
|------|-------------|
| `conio.h` (text screen, windows, scrolling) | an 80×25 cell buffer in `shim.c`; `web/app.js` paints it on a canvas (9×16 cells, CP437) |
| `int86(0x10)` (cursor, VGA palette) | `shim.c`; the program's neon palette works as it does on VGA |
| `getch`/`kbhit` | a keyboard queue in `app.js`, blocking through Asyncify |
| `delay`/`sound`/`nosound` | a virtual program clock and timestamped WebAudio events (square-wave oscillator) |
| `TINY.BIN` next to the EXE | embedded in the WASM with `--embed-file` |

## Build and deploy

    ./build.sh                 # builds dist/ and installs it to /var/www/gottz.tiny
    BUILD_ONLY=1 ./build.sh    # dist/ only
    ./build.sh --help

Needs Docker (image `emscripten/emsdk:6.0.13`), Python 3 and the kbd console font
`default8x16.psfu.gz`. `upstream/` is a clone of the upstream repository and not part of this
one: `build.sh` fetches it on the first run. The expected commit is pinned in `build.sh`
(`UPSTREAM_COMMIT`); raise it on purpose when taking a new upstream version.

`DEPLOY_DIR` sets the install target. The site is plain static files and works under a strict
Content Security Policy:

    default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
    img-src 'self'; connect-src 'self'

## Tests

Headless Chrome through a globally installed puppeteer:

    node test/smoke.cjs https://tiny.gottz.de/ <output dir>   # boot, questions, F1/F4, Esc, restart
    node test/audio.cjs https://tiny.gottz.de/                # speaker timestamps in order, none late
    node test/touch.cjs https://tiny.gottz.de/ <output dir>   # phone input path, /DEMO, /QUIET

Reference for answers: `gcc -x c upstream/TINY.C -lm`, then `./a.out 0 /p` (creativity 0 is
deterministic); the page takes `?creativity=0`. Other address options: `?demo`, `?quiet`,
`?classic`, `?mono`. `window.tinyScreen()` returns the screen as text.

## Known limits

- Upstream has no license file (see License).
- The sound has only been checked by measuring event timestamps, not by ear.
- The network runs at browser speed (over 100 letters per second), so the loading bar and the
  reading scanner are on screen for much less time than on a 486.

## License

MIT (see `LICENSE`) for everything in this repository: shim, web front end, build and tests.
TINY 2.1 itself (`TINY.C`, `TINY.BIN`) is by WollyMonjac, is not part of this repository and is
not covered by this license; neither is the kbd console font read at build time.
