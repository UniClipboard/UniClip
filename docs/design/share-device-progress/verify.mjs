// Run: ego-browser nodejs < docs/design/share-device-progress/verify.mjs
// Serve this folder at http://127.0.0.1:8741 before running.
const task = await taskSpace('share-device-progress-review');
const page = task.page('p1');
const fs = await import('node:fs/promises');
const output = '/tmp/share-device-progress-evidence';
await fs.mkdir(output, { recursive: true });
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1080, deviceScaleFactor: 1, mobile: false });
await page.goto('http://127.0.0.1:8741');
console.log(await page.snapshot({ scope: 'full_page' }));
const checks = [];
async function check(name, fn) {
  const passed = await page.evaluate(fn);
  checks.push({ name, passed });
  if (!passed) throw new Error(name);
}
await check('Results section removed and thumbnail loaded', () => !document.querySelector('.sheet').textContent.includes('发送结果') && document.querySelector('img').naturalWidth > 0);
const bounds = await page.evaluate(() => { const r = document.querySelector('#device').getBoundingClientRect(); return { x: r.right - 8, y: r.top + 12 }; });
await page.mouse.click(bounds.x, bounds.y);
await check('Empty trailing space deselects the device', () => document.querySelector('#device').getAttribute('aria-pressed') === 'false' && document.querySelector('#send').disabled);
await page.mouse.click(bounds.x, bounds.y);
await check('Empty trailing space reselects the device', () => document.querySelector('#device').getAttribute('aria-pressed') === 'true' && !document.querySelector('#send').disabled);
await page.click('[data-state="sending"]');
await page.waitForFunction(() => Math.abs(document.querySelector('#fill').getBoundingClientRect().width / document.querySelector('#device').getBoundingClientRect().width - .46) < .01);
await check('46 percent fills 46 percent of the device row', () => document.querySelector('#marker').textContent === '46%' && document.querySelector('#send').disabled && document.querySelector('#device').disabled);
await page.screenshot({ path: output + '/desktop-progress.png' });
await page.click('[data-state="ready"]');
await page.click('#send');
await page.waitForFunction(() => document.querySelector('#fill').getAttribute('aria-valuenow') > 0);
await check('Send starts progress and prevents duplicate sends', () => document.querySelector('#send').disabled && document.querySelector('#device-status').textContent === '正在发送');
await page.waitForFunction(() => document.querySelector('#device-status').textContent === '等待设备确认…', undefined, { timeout: 15000 });
await check('100 percent waits for confirmation', () => document.querySelector('#send').disabled && document.querySelector('#fill').style.width === '100%');
await page.waitForFunction(() => document.querySelector('#send').textContent === '完成');
await check('Confirmation produces success', () => document.querySelector('#device').classList.contains('success') && document.querySelector('#device-status').textContent === '已发送');
await page.screenshot({ path: output + '/desktop-success.png' });
await page.click('#send');
await check('Complete resets the demo', () => document.querySelector('#send').textContent === '发送' && document.querySelector('#fill').style.width === '0%');
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 1040, deviceScaleFactor: 1, mobile: false });
await page.click('[data-state="sending"]');
await page.evaluate(() => window.scrollTo(0, 0));
await check('Mobile viewport has no horizontal overflow', () => document.documentElement.scrollWidth <= innerWidth);
await page.screenshot({ path: output + '/mobile-progress.png' });
await fs.writeFile(output + '/checks.json', JSON.stringify({ url: 'http://127.0.0.1:8741', checks }, null, 2));
console.log(JSON.stringify({ evidence: output, checks }));
await task.finish({ keep: ['p1'] });
