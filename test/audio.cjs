// Speaker timing test: records every scheduled speaker event while TINY
// speaks one answer and checks them against the program's own timeline.
// Usage: node test/audio.cjs URL
const puppeteer = require('/usr/lib/node_modules/puppeteer');
const url = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP ' + r.status() + ' ' + r.url()); });
  await page.evaluateOnNewDocument(() => {
    window.ev = [];
    const orig = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (v, t) {
      window.ev.push([v, t, window.__ac ? window.__ac.currentTime : -1]);
      return orig.call(this, v, t);
    };
    const AC = window.AudioContext;
    window.AudioContext = function () { const a = new AC(); window.__ac = a; return a; };
  });
  await page.goto(url + '?creativity=0', { waitUntil: 'networkidle0' });
  await page.click('button[data-run=""]');
  await sleep(7500);
  console.log('audio state: ' + await page.evaluate(() => window.__ac && window.__ac.state));
  await page.keyboard.press('Space');
  await sleep(1500);
  await page.evaluate(() => { window.ev.length = 0; });
  await page.keyboard.type('is a whale a fish', { delay: 10 });
  await page.keyboard.press('Enter');
  await sleep(5000);
  const r = await page.evaluate(() => {
    const ev = window.ev;
    let late = 0, back = 0, last = -1;
    const gaps = [];
    for (const [, t, now] of ev) {
      if (t <= now + 1e-6) late++;
      if (t < last - 1e-9) back++;
      if (last >= 0) gaps.push(Math.round((t - last) * 1000));
      last = t;
    }
    const hist = {};
    for (const g of gaps) hist[g] = (hist[g] || 0) + 1;
    return { events: ev.length, late, backwards: back, spanSeconds: ev.length ? ev[ev.length - 1][1] - ev[0][1] : 0, gapHistogramMs: hist };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
