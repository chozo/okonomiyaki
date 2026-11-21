const path = require('path');
const { chromium } = require('playwright-core');
(async () => {
  const file = process.argv[2];
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' }); // Mac mini ではインストール済み Chrome を使う
  const page = await browser.newPage({ viewport: { width: 390, height: 693 } });
  const msgs = [];
  page.on('pageerror', e => msgs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') msgs.push('console.error: ' + m.text().slice(0, 200)); });
  await page.goto('file://' + file);
  await new Promise(r => setTimeout(r, 5000));
  const state = await page.evaluate(() => ({ phase: window.__oko ? window.__oko.phase : null })).catch(e => ({ evalError: e.message }));
  console.log(file.split('/').pop(), JSON.stringify(state), 'errors:', msgs.length ? msgs.slice(0,3).join(' | ') : 'none');
  await browser.close();
})();
