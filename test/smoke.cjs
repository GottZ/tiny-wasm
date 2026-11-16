// Smoke test: boots TINY in headless Chrome, asks questions at creativity 0
// and prints the screen. Usage: node test/smoke.cjs URL OUTDIR
const puppeteer = require('/usr/lib/node_modules/puppeteer');
const [url, out] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1000 });
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
  await page.goto(url + '?creativity=0', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: out + '/0-power.png' });
  await page.click('button[data-run=""]');
  await sleep(1200);
  await page.screenshot({ path: out + '/1-rain.png' });
  await sleep(6000);
  await page.screenshot({ path: out + '/2-boot.png' });
  console.log('--- boot screen\n' + await page.evaluate(() => window.tinyScreen()));
  await page.keyboard.press('Space');
  await sleep(1500);
  const ask = async (q, wait) => {
    await page.keyboard.type(q, { delay: 15 });
    await page.keyboard.press('Enter');
    await sleep(wait);
  };
  await ask('what is the capital of peru', 3000);
  await ask('is a whale a fish', 5000);
  await page.screenshot({ path: out + '/3-chat.png' });
  await ask('what is 7 times 8', 4000);
  await ask('spell elephant', 5000);
  await ask('which countries border estonia', 5000);
  await page.keyboard.press('F1');
  await sleep(300);
  await page.keyboard.press('F4');
  await sleep(300);
  await page.screenshot({ path: out + '/4-chat.png' });
  console.log('--- chat screen\n' + await page.evaluate(() => window.tinyScreen()));
  await page.keyboard.press('Escape');
  await sleep(2500);
  await page.screenshot({ path: out + '/5-exit.png' });
  console.log('--- after quit\n' + await page.evaluate(() => window.tinyScreen()));
  console.log('power overlay visible: ' + await page.evaluate(() => !document.getElementById('power').hidden));
  await page.keyboard.press('Enter');
  await sleep(1500);
  console.log('restarted, overlay hidden: ' + await page.evaluate(() => document.getElementById('power').hidden));
  console.log('--- problems: ' + (problems.length ? '\n' + problems.join('\n') : 'none'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
