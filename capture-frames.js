// Capture real SkinMirror UI frames with Playwright for the demo video.
// Usage: PORT=3104 node server.js &  node capture-frames.js http://localhost:3104
// Output: /tmp/shots/frame-*.png (upload step, sample dashboard, routine).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const base = process.argv[2] || 'http://localhost:3104';
  fs.mkdirSync('/tmp/shots', { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/shots/frame-01-upload.png' });
  await page.click('#sampleBtn');
  await page.waitForSelector('#resultCard:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/shots/frame-02-dashboard.png' });
  await page.evaluate(() => document.getElementById('routineCard').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/shots/frame-03-routine.png' });
  await page.evaluate(() => document.getElementById('vtoCard').scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/shots/frame-04-vto.png' });
  await browser.close();
  console.log('frames saved to /tmp/shots');
})().catch((e) => { console.error(e); process.exit(1); });
