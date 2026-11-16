/* app.js - the "PC" around TINY: paints the 80x25 text screen, feeds the
   keyboard queue and plays the PC speaker.  The program itself is tiny.wasm
   (TINY.C + shim.c); this file never looks inside the network. */
'use strict';
(() => {
  const COLS = 80, ROWS = 25;
  const CELL_W = 9, CELL_H = 16;                // VGA text cell
  const W = COLS * CELL_W, H = ROWS * CELL_H;   // 720 x 400
  const BLINK_MS = 266;
  const AUDIO_LEAD = 0.1;                       // seconds; hides timer jitter
  const VOLUME = 0.1;

  const font = Uint8Array.from(atob(TINY_FONT), (c) => c.charCodeAt(0));
  const canvas = document.getElementById('screen');
  const power = document.getElementById('power');
  const hint = document.getElementById('hint');
  const keysField = document.getElementById('keys');

  /* ---- screen ---- */

  const view = canvas.getContext('2d');
  const exact = document.createElement('canvas');   // 720x400, one pixel per dot
  exact.width = W; exact.height = H;
  const exactCtx = exact.getContext('2d');
  const image = exactCtx.createImageData(W, H);
  const pixels = new Uint32Array(image.data.buffer);
  const sharp = document.createElement('canvas');   // whole-number enlargement
  const sharpCtx = sharp.getContext('2d');

  let mod = null;           // the running program
  let cells = null;         // its screen: character, attribute per cell
  let colors = null;        // 16 text colours, RGB
  let state = null;         // [changes, cursor x, cursor y, cursor visible]
  let running = false;
  let seenChanges = -1, seenBlink = -1;

  function fitCanvas() {
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(box.width * ratio));
    const h = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    sharp.width = W * Math.max(1, Math.ceil(w / W));
    sharp.height = H * Math.max(1, Math.ceil(h / H));
    seenChanges = -1;
  }

  /* Dots are drawn exactly, enlarged by whole numbers without smoothing, and
     only then fitted to the 4:3 tube: letters stay crisp at any size. */
  function present() {
    exactCtx.putImageData(image, 0, 0);
    sharpCtx.imageSmoothingEnabled = false;
    sharpCtx.drawImage(exact, 0, 0, sharp.width, sharp.height);
    view.imageSmoothingEnabled = true;
    view.imageSmoothingQuality = 'high';
    view.drawImage(sharp, 0, 0, canvas.width, canvas.height);
  }

  function paint() {
    requestAnimationFrame(paint);
    if (!cells) return;
    const cursorOn = running && state[3] !== 0;
    const blink = cursorOn ? Math.floor(performance.now() / BLINK_MS) & 1 : 0;
    if (state[0] === seenChanges && blink === seenBlink) return;
    seenChanges = state[0];
    seenBlink = blink;

    const rgba = new Uint32Array(16);
    for (let i = 0; i < 16; i++)
      rgba[i] = 0xFF000000 | (colors[i * 3 + 2] << 16) | (colors[i * 3 + 1] << 8) | colors[i * 3];

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const at = (y * COLS + x) * 2;
        const ch = cells[at], attr = cells[at + 1];
        const fg = rgba[attr & 15], bg = rgba[attr >> 4];
        const boxChar = ch >= 0xC0 && ch <= 0xDF;   // VGA repeats column 8 for these
        let to = y * CELL_H * W + x * CELL_W;
        for (let row = 0; row < CELL_H; row++, to += W) {
          const bits = font[ch * 16 + row];
          for (let b = 0; b < 8; b++)
            pixels[to + b] = bits & (0x80 >> b) ? fg : bg;
          pixels[to + 8] = boxChar && (bits & 1) ? fg : bg;
        }
      }
    }
    if (blink && state[1] >= 0 && state[1] < COLS && state[2] >= 0 && state[2] < ROWS) {
      const fg = rgba[cells[(state[2] * COLS + state[1]) * 2 + 1] & 15];
      for (let row = 13; row <= 14; row++) {
        const to = (state[2] * CELL_H + row) * W + state[1] * CELL_W;
        for (let b = 0; b < CELL_W; b++) pixels[to + b] = fg;
      }
    }
    present();
  }

  /* ---- PC speaker ---- */

  let audio = null, speaker = null, gate = null;

  function audioOn() {
    if (audio) {
      audio.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    audio = new Ctor();
    speaker = audio.createOscillator();
    speaker.type = 'square';
    gate = audio.createGain();
    gate.gain.value = 0;
    const cone = audio.createBiquadFilter();        // a small paper cone, not hi-fi
    cone.type = 'lowpass';
    cone.frequency.value = 6000;
    const volume = audio.createGain();
    volume.gain.value = VOLUME;
    speaker.connect(gate).connect(cone).connect(volume).connect(audio.destination);
    speaker.start();
  }

  /* The audio clock only moves in steps of a few milliseconds, so reading
     it afresh for every event would shuffle 1 ms speaker steps. Keep one
     steady offset between the two clocks; start over if they part ways
     (the tab slept, the audio device changed). */
  let clockOffset = null, lastWhen = 0;

  function audioTime(at) {
    const sample = audio.currentTime - performance.now() / 1000;
    if (clockOffset === null || Math.abs(sample - clockOffset) > 0.02) {
      clockOffset = sample;
      lastWhen = 0;
    } else if (sample > clockOffset) {
      clockOffset = sample;
    }
    const when = Math.max(at / 1000 + clockOffset + AUDIO_LEAD, audio.currentTime, lastWhen);
    lastWhen = when;
    return when;
  }

  /* hz 0 = silence; `at` is the program's clock in performance.now() time */
  function sound(hz, at) {
    if (!audio || audio.state !== 'running') return;
    const when = audioTime(at);
    if (hz > 0) {
      speaker.frequency.setValueAtTime(Math.min(hz, 20000), when);
      gate.gain.setValueAtTime(1, when);
    } else {
      gate.gain.setValueAtTime(0, when);
    }
  }

  function silence() {
    if (!audio) return;
    gate.gain.cancelScheduledValues(0);
    speaker.frequency.cancelScheduledValues(0);
    gate.gain.setValueAtTime(0, audio.currentTime);
    clockOffset = null;
  }

  /* ---- keyboard ---- */

  let queue = [];
  const EXT = { F1: 59, F2: 60, F3: 61, F4: 62, ArrowUp: 72 };

  function press(code) { if (running) queue.push(code); }
  function pressExt(scan) { if (running) queue.push(0, scan); }  // as DOS getch() reports it

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!running) {
      if (e.key === 'Enter' && !e.repeat && document.activeElement.tagName !== 'BUTTON') {
        e.preventDefault();
        start([]);
      }
      return;
    }
    const k = e.key;
    if (k === 'Enter') press(13);
    else if (k === 'Backspace') press(8);
    else if (k === 'Escape') press(27);
    else if (EXT[k]) pressExt(EXT[k]);
    else if (k.length === 1 && k >= ' ' && k <= '~') press(k.charCodeAt(0));
    else return;                                    // phones: see the field below
    e.preventDefault();
  });

  /* On-screen keyboards often send no usable keydown. The hidden field
     keeps one space in it: longer means typed text, shorter means delete.
     Enter still arrives as a keydown, a one-line field never holds one. */
  const REST = ' ';
  keysField.value = REST;
  keysField.addEventListener('input', () => {
    const v = keysField.value;
    if (v.length < REST.length) press(8);
    for (const ch of v.slice(REST.length))
      if (ch >= ' ' && ch <= '~') press(ch.charCodeAt(0));
    keysField.value = REST;
  });

  document.getElementById('keyrow').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ext) pressExt(Number(b.dataset.ext));
    else press(Number(b.dataset.key));
    keysField.focus({ preventScroll: true });
  });

  /* ---- running the program ---- */

  let printed = [];

  /* What a DOS screen shows after a program ends: its last words, a prompt. */
  function exited() {
    running = false;
    silence();
    const lines = printed.concat(['', 'C:\\TINY>']);
    let row = 0;
    for (const line of lines.slice(-ROWS)) {
      for (let x = 0; x < COLS && x < line.length; x++) {
        const code = line.charCodeAt(x);
        cells[(row * COLS + x) * 2] = code < 256 ? code : 63;
        cells[(row * COLS + x) * 2 + 1] = 7;
      }
      row++;
    }
    seenChanges = -1;
    hint.textContent = 'TINY has ended. Click or press Enter to run it again.';
    hint.classList.remove('error');
    setTimeout(() => { if (!running) power.hidden = false; }, 900);
  }

  function failed(err) {
    running = false;
    starting = false;
    power.hidden = false;
    hint.textContent = 'TINY could not start: ' + (err && err.message ? err.message : err);
    hint.classList.add('error');
  }

  let starting = false;

  function start(extraArgs) {
    if (running || starting) return;
    starting = true;
    audioOn();
    silence();
    queue = [];
    printed = [];
    const args = optionsFromAddress().concat(extraArgs);
    createTiny({
      print: (line) => printed.push(line),
      printErr: (line) => console.warn(line),
      tiny: {
        sound,
        keyWaiting: () => (queue.length ? 1 : 0),
        keyTake: () => queue.shift(),
        exited,
      },
    }).then((m) => {
      mod = m;
      const heap = m.HEAPU8;
      cells = heap.subarray(m._shim_screen(), m._shim_screen() + COLS * ROWS * 2);
      colors = heap.subarray(m._shim_palette(), m._shim_palette() + 48);
      state = new Int32Array(heap.buffer, m._shim_state(), 4);
      seenChanges = -1;
      running = true;
      starting = false;
      power.hidden = true;
      keysField.focus({ preventScroll: true });
      m.callMain(args);
    }).catch(failed);
  }

  /* tiny.gottz.de/?demo&quiet&classic&mono&creativity=0 -> TINY /DEMO /QUIET ... */
  function optionsFromAddress() {
    const q = new URLSearchParams(location.search);
    const args = [];
    for (const name of ['demo', 'quiet', 'classic', 'mono'])
      if (q.has(name)) args.push('/' + name.toUpperCase());
    const c = q.get('creativity');
    if (c !== null && /^[0-9]$/.test(c)) args.push(c);
    return args;
  }

  /* the screen as 25 lines of text, for tests and the curious */
  window.tinyScreen = () => {
    if (!cells) return '';
    const lines = [];
    for (let y = 0; y < ROWS; y++) {
      let line = '';
      for (let x = 0; x < COLS; x++) {
        const c = cells[(y * COLS + x) * 2];
        line += c >= 32 && c < 127 ? String.fromCharCode(c) : c ? '#' : ' ';
      }
      lines.push(line.replace(/\s+$/, ''));
    }
    return lines.join('\n');
  };

  power.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    start(b && b.dataset.run ? [b.dataset.run] : []);
  });

  window.addEventListener('resize', fitCanvas);
  if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe(canvas);
  fitCanvas();
  requestAnimationFrame(paint);
})();
