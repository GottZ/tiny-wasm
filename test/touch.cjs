// Phone path: text arrives through the hidden field's input events, keys
// through the on-screen buttons; then a /DEMO start. Usage: node test/touch.cjs URL OUTDIR
const puppeteer = require('/usr/lib/node_modules/puppeteer');
const [url, out] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(url + '?creativity=0', { waitUntil: 'networkidle0' });
  await page.tap('button[data-run=""]');
  await sleep(7500);
  const feed = (value) => page.evaluate((v) => {
    const f = document.getElementById('keys');
    f.value = v;
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await feed(' x');                       // any key: begin
  await sleep(1500);
  for (const ch of 'opposite of hotx') await feed(' ' + ch);
  await feed('');                         // delete the stray x
  await page.keyboard.press('Enter');     // Enter does arrive as a keydown
  await sleep(4000);
  await page.tap('button[data-ext="62"]'); // F4
  await sleep(300);
  await page.screenshot({ path: out + '/phone.png' });
  const text = await page.evaluate(() => window.tinyScreen());
  console.log(text.split('\n').filter((l) => /YOU|TINY #|Creativity/.test(l)).join('\n'));
  console.log('page scrolls sideways: ' + await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  await page.goto(url + '?quiet', { waitUntil: 'networkidle0' });
  await page.tap('button[data-run="/DEMO"]');
  await sleep(16000);
  const demo = await page.evaluate(() => window.tinyScreen());
  console.log('--- demo\n' + demo.split('\n').filter((l) => /YOU|TINY #|Sound/.test(l)).join('\n'));
  console.log('--- problems: ' + (problems.length ? problems.join(' | ') : 'none'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
