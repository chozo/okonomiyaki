// 画面確認：実際のクリック・スワイプ・ドラッグで遊び、各場面のスクリーンショットを撮る。
// 実行: node tests/screens.js   （../tools の Playwright を使用）
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
// ?fixedpr: 自動解像度調整を止める（ヘッドレスは遅く解像度が落ちるため、くっきり撮る）
const URL = 'file://' + path.resolve(__dirname, '../dist/okonomiyaki/index.html') + '?fixedpr';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const log = (...a) => console.log(...a);

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 693 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  // 共有APIへの接触を数えるスパイ（ページのスクリプトより先に仕込む）
  await page.addInitScript(() => {
    const hits = window.__shareHits = [];
    const spy = (obj, key, label) => {
      const d = Object.getOwnPropertyDescriptor(obj, key); if (!d) return;
      Object.defineProperty(obj, key, { configurable: true, get() { hits.push(label + '@' + (window.__oko ? window.__oko.phase : 'load')); return d.get ? d.get.call(this) : d.value; }, set(v) { Object.defineProperty(obj, key, { value: v, configurable: true, writable: true }); } });
    };
    spy(Navigator.prototype, 'share', 'navigator.share'); spy(Navigator.prototype, 'canShare', 'navigator.canShare');
    spy(window, 'File', 'File');
    const tb = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function () { hits.push('toBlob@' + (window.__oko ? window.__oko.phase : 'load')); return tb.apply(this, arguments); };
    const wo = window.open; window.open = function () { hits.push('open@' + (window.__oko ? window.__oko.phase : 'load')); return wo.apply(this, arguments); };
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__oko && window.__oko.phase === 'title');
  await page.click('#startBtn', { force: true }); // 脈動アニメーションがあるので force
  await page.waitForFunction(() => window.__oko.phase === 'pour');
  await sleep(600);
  return page;
}
async function waitFor(page, fn, arg, timeout = 120000) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 30 }); }
  catch (e) { console.log('  state at timeout:', JSON.stringify(await page.evaluate(() => ({ phase: window.__oko.phase, ...window.__oko.info() })))); throw e; }
}
const layoutIssues = [];
// 文字レイアウト検査：表示中の UI 文字（テキストノード単位の実グリフ矩形）について
//  - 9:16 の #app 内に収まっているか / 属するボタン・カード（button, .sheet, .meter, .polaroid）からはみ出していないか
//  - 別の文字と重なっていないか / ボタン同士が重なっていないか / 要素が scrollWidth でオーバーフローしていないか
async function checkLayout(page, name) {
  const res = await page.evaluate(() => {
    const app = document.getElementById('app').getBoundingClientRect();
    const out = [], texts = [];
    const visible = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false; } return true; };
    const label = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
    const walker = document.createTreeWalker(document.getElementById('ui'), NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (!n.textContent.trim() || !visible(n.parentElement)) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      const rects = [...r.getClientRects()].filter(q => q.width > 0.5 && q.height > 0.5);
      const box = n.parentElement.closest('button, .sheet, .meter, .polaroid');
      // 行ボックス（フォントの上下余白込み）ではなく、実際に字が描かれる em ボックス（高さ = font-size）で判定する
      const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
      for (const q0 of rects) {
        const cy = (q0.top + q0.bottom) / 2, hh = Math.min(q0.height, fs) / 2;
        const q = { left: q0.left, right: q0.right, top: cy - hh, bottom: cy + hh };
        const t = n.textContent.trim().slice(0, 14), who = label(n.parentElement) + ' "' + t + '"';
        texts.push({ q, who, node: n });
        const tol = 1;
        if (q.left < app.left - tol || q.right > app.right + tol || q.top < app.top - tol || q.bottom > app.bottom + tol) out.push('off-screen: ' + who);
        if (box) { const b = box.getBoundingClientRect(); if (q.left < b.left - tol || q.right > b.right + tol || q.top < b.top - tol || q.bottom > b.bottom + tol) out.push('outside ' + label(box) + ': ' + who); }
      }
    }
    // 文字どうしの重なり（2px 以上食い込んだら NG）
    for (let i = 0; i < texts.length; i++) for (let k = i + 1; k < texts.length; k++) {
      const a = texts[i].q, b = texts[k].q;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) out.push('overlap: ' + texts[i].who + ' × ' + texts[k].who);
    }
    // 文字がそれを含まないボタンに重なる / ボタン同士の重なり
    const btns = [...document.querySelectorAll('#ui button')].filter(visible);
    for (const t of texts) for (const bt of btns) {
      if (bt.contains(t.node)) continue;
      const b = bt.getBoundingClientRect(), a = t.q;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push('text over ' + label(bt) + ': ' + t.who);
    }
    for (let i = 0; i < btns.length; i++) for (let k = i + 1; k < btns.length; k++) {
      const a = btns[i].getBoundingClientRect(), b = btns[k].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push('buttons overlap: ' + label(btns[i]) + ' × ' + label(btns[k]));
    }
    for (const el of document.querySelectorAll('#ui *')) {
      if (!visible(el) || el.tagName === 'svg' || el.closest('svg')) continue;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).display !== 'inline') out.push('scroll-overflow: ' + label(el) + ' ' + el.scrollWidth + '>' + el.clientWidth);
    }
    return { issues: out, nText: texts.length };
  });
  if (res.issues.length) { layoutIssues.push(...res.issues.map(s => name + ': ' + s)); log('  LAYOUT NG', name, res.issues); }
  else log('  layout ok', name, '(' + res.nText + ' text boxes)');
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); log('  screenshot', name + '.png'); await checkLayout(page, name); };

// 狙ったフリック（速さ m/s, 角度 deg）をスワイプとして入力する。
// ヘッドレス SwiftShader は ~20fps で page.mouse.move 1回に 80〜400ms かかり、速さが正しく測れない。
// そこでページ内から PointerEvent を stage に dispatch し（ゲームの本物の入力ハンドラを通る）、
// 位置を「実経過時間 × 一定速度」で決めることで、フレーム落ちがあっても狙った速さになるようにする。
async function swipe(page, flick) {
  await page.evaluate(async (f) => {
    const H = window.__oko.viewH(), r = window.__oko.appRect();
    const sw = window.OkoLogic.swipeForFlick(f, 100, H); // 100ms あたりの移動量
    const vx = sw.dx / 100, vy = sw.dy / 100;            // px/ms
    const x0 = r.x + r.w * 0.3, y0 = r.y + r.h * 0.86, stage = document.getElementById('stage');
    const ev = (type, x, y) => stage.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true }));
    ev('pointerdown', x0, y0);
    const t0 = performance.now(); let el = 0;
    while (el < 160) {
      await new Promise(res => setTimeout(res, 8));
      el = performance.now() - t0; // 頭打ちにしない：位置は常に「実経過時間 × 一定速度」
      ev('pointermove', x0 + vx * el, y0 + vy * el);
    }
    ev('pointerup', x0 + vx * el, y0 + vy * el);
  }, flick);
}
// 生地を落とす：本物のマウスで「長押しで落とす」ボタンを押し続け、目標量に達したら離す
async function pourTo(page, ml, shotName) {
  const b = await page.locator('#pourBtn').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  if (shotName) { await waitFor(page, v => window.__oko.info().shape.volume * 1e6 >= v, ml * 0.5); await shot(page, shotName + '_pouring'); }
  await waitFor(page, v => window.__oko.info().shape.volume * 1e6 >= v, ml - 25);
  await page.mouse.up();
  await sleep(250);
}
// 広げる：本物のマウスで生地のふちを円を描くようにドラッグし、目標の直径に達するまで回す
async function spreadTo(page, cmTarget) {
  let c = await page.evaluate(() => window.__oko.discScreen());
  let ang = 0;
  const pt = () => [c.x + Math.cos(ang) * c.r * 0.95, c.y + Math.sin(ang) * c.r * 0.95 * 0.8];
  await page.mouse.move(...pt()); await page.mouse.down();
  for (let i = 0; i < 400; i++) {
    const d = await page.evaluate(() => window.__oko.info().shape.diameter * 100);
    if (d >= cmTarget) break;
    if (i % 6 === 0) c = await page.evaluate(() => window.__oko.discScreen());
    ang += 0.45; await page.mouse.move(...pt());
  }
  return { release: async () => { await page.mouse.up(); await sleep(200); } };
}
async function prepare(page, ml, cmTarget, shotName) {
  await pourTo(page, ml, shotName);
  if (shotName) await shot(page, shotName + 'a_poured');
  const h = await spreadTo(page, cmTarget);
  if (shotName) await shot(page, shotName + 'b_spreading'); // ドラッグ中（おたまが見える）
  await h.release();
  const i = await page.evaluate(() => window.__oko.info());
  log(`  生地: ${(i.shape.volume * 1e6).toFixed(0)}ml 直径 ${(i.shape.diameter * 100).toFixed(1)}cm 厚み ${(i.shape.thickness * 100).toFixed(2)}cm  表示: 直径 ${i.meter.dia} / 厚み ${i.meter.thk} / ${i.meter.vol}ml / 最高 ${i.meter.max}`);
  return i;
}
async function cookTo(page, targetD) {
  await page.click('#cookBtn');
  await waitFor(page, d => window.__oko.info().d >= d, targetD);
}
async function flipWith(page, flickFn) {
  await page.click('#flipBtn');
  await waitFor(page, () => window.__oko.phase === 'flipReady');
  if (!flipWith.shotDone) { flipWith.shotDone = true; await sleep(400); await shot(page, '02b_flip_guide'); } // フリック指示（1回だけ）
  const info = await page.evaluate(() => window.__oko.info());
  const flick = await page.evaluate(flickFn, { size: info.size, d: info.flipD });
  // ゲームが使った size が「広げた実測値」から作られていることを確認
  const chk = await page.evaluate(({ size }) => Math.abs(size.thickness - OkoLogic.thicknessFrom(size.volume, size.diameter)), { size: info.size });
  if (chk > 1e-12) throw new Error('size not derived from volume/area');
  await swipe(page, flick);
  return { intended: flick, flipD: info.flipD };
}
const report = async (page, label, intended) => {
  const i = await page.evaluate(() => window.__oko.info());
  log(`  [${label}] 直径=${(i.size.diameter * 100).toFixed(1)}cm 厚み=${(i.size.thickness * 100).toFixed(2)}cm 焼き=${Math.round(i.flipD * 100)}% 狙い v=${intended.speed.toFixed(2)} θ=${intended.angle.toFixed(1)} → 実測 v=${i.flick.speed.toFixed(2)} θ=${i.flick.angle.toFixed(1)} 判定=${i.judgement.tier} e=${i.judgement.e.toFixed(2)} score=${i.score}`);
  return i;
};

// ---- Xに投稿のブラウザ内テスト（実投稿はしない）
const shareChecks = [];
const check = (name, ok, detail) => { shareChecks.push({ name, ok }); log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
// (a) 共有用 blob が PNG として得られ、中身が空でなく、表示中の写真と同じ画像か
async function checkShareBlob(page, label, imgSel) {
  const r = await page.evaluate(async (imgSel) => {
    await window.__oko.lastShare();
    const b = window.__oko.lastShareBlob();
    if (!b) return null;
    const head = [...new Uint8Array(await b.slice(0, 8).arrayBuffer())];
    const bmp = await createImageBitmap(b);
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data; let mn = 255, mx = 0, cols = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; mn = Math.min(mn, l); mx = Math.max(mx, l); cols.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); }
    let same = null;
    if (imgSel) { // 表示中の <img> を同サイズで描いて画素比較
      const img = document.querySelector(imgSel); await img.decode();
      const c2 = new OffscreenCanvas(bmp.width, bmp.height), g2 = c2.getContext('2d'); g2.drawImage(img, 0, 0);
      const d2 = g2.getImageData(0, 0, bmp.width, bmp.height).data; let diff = 0;
      for (let i = 0; i < d.length; i++) diff = Math.max(diff, Math.abs(d[i] - d2[i]));
      same = { natural: img.naturalWidth + 'x' + img.naturalHeight, maxDiff: diff };
    }
    return { type: b.type, size: b.size, png: head.join(',') === '137,80,78,71,13,10,26,10', w: bmp.width, h: bmp.height, lumRange: mx - mn, colors: cols.size, same, text: window.__oko.shareText() };
  }, imgSel);
  check(`${label}: blob が得られる (image/png, PNG署名)`, !!r && r.type === 'image/png' && r.png && r.size > 10000, r && `${r.size} bytes ${r.w}x${r.h}`);
  check(`${label}: 画像は正方形で中身がある（単色でない）`, !!r && r.w === r.h && r.lumRange > 60 && r.colors > 30, r && `輝度幅 ${r.lumRange.toFixed(0)} 色数 ${r.colors}`);
  if (imgSel) check(`${label}: 共有画像＝画面に表示中の写真（画素一致）`, !!r && r.same.maxDiff === 0 && r.same.natural === r.w + 'x' + r.h, r && JSON.stringify(r.same));
  return r;
}
// (b) navigator.share が無い環境：実マウスでボタンを押し、ダウンロード＋インテントURLが開くか
async function checkFallback(page, btnSel, label, expectText) {
  await page.evaluate(() => {
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
    window.__opened = []; window.open = (u, t, f) => { window.__opened.push({ u, t, f }); return null; };
  });
  const b = await page.locator(btnSel).boundingBox();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)]);
  const file = path.join(OUT, 'shared_image_' + ({ '完成写真': 'photo', '大失敗': 'collapse' }[label] || 'x') + '.png'); // 実際にダウンロードされた共有画像を保存（目視確認用）
  await dl.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 8).toString('hex');
  const res = await page.evaluate(async () => ({ r: await window.__oko.lastShare(), opened: window.__opened }));
  const u = res.opened[0] && new (require("url").URL)(res.opened[0].u);
  check(`${label}: share 無し → フォールバック`, res.r && res.r.mode === 'fallback' && res.r.reason === 'no-share', JSON.stringify(res.r && { mode: res.r.mode, reason: res.r.reason }));
  check(`${label}: PNG がダウンロードされる`, dl.suggestedFilename() === 'okonomiyaki.png' && head === '89504e470d0a1a0a', `${dl.suggestedFilename()} ${fs.statSync(file).size} bytes`);
  check(`${label}: インテントURLが1回開く（文面入り）`, res.opened.length === 1 && u.origin + u.pathname === 'https://twitter.com/intent/tweet' && u.searchParams.get('text') === expectText, u && decodeURIComponent(u.search));
}
// 共有ボタンを押す前に共有API（navigator.share/canShare, File, toBlob, window.open）に誰も触れていないこと
async function checkNoShareTouch(page, label) {
  const h = await page.evaluate(() => window.__shareHits.slice());
  check(`${label}: クリック前は共有APIに一度も触れていない`, h.length === 0, h.length ? JSON.stringify(h) : 'hits=0');
}
// 共有処理が例外を出す環境：ボタンが無効化されるだけで、ゲームは続行できる
async function checkFailureDisables(page, btnSel, label) {
  await page.evaluate(() => {
    Object.defineProperty(Navigator.prototype, 'share', { value: async () => {}, configurable: true, writable: true });
    Object.defineProperty(Navigator.prototype, 'canShare', { value: () => { throw new Error('boom'); }, configurable: true, writable: true });
  });
  await page.click(btnSel);
  const r = await page.evaluate(async (sel) => ({ r: await window.__oko.lastShare(), disabled: document.querySelector(sel).disabled }), btnSel);
  check(`${label}: 共有が例外 → ボタン無効化のみ（JSエラーにしない）`, r.r && r.r.mode === 'disabled' && r.disabled === true, JSON.stringify(r));
}
// navigator.share がある環境（モック）：画像ファイル＋文面が渡るか
async function checkWebShareMock(page, btnSel, label, expectText) {
  await page.evaluate(() => {
    window.__shared = null; window.__opened = [];
    Object.defineProperty(Navigator.prototype, 'canShare', { value: function (d) { return !!(d && d.files && d.files.every(f => f instanceof File)); }, configurable: true });
    Object.defineProperty(Navigator.prototype, 'share', { value: async function (d) { window.__shared = { text: d.text, files: d.files.map(f => ({ name: f.name, type: f.type, size: f.size })) }; }, configurable: true });
  });
  await page.click(btnSel);
  const res = await page.evaluate(async () => ({ r: await window.__oko.lastShare(), shared: window.__shared, opened: window.__opened.length, blobSize: window.__oko.lastShareBlob().size }));
  const f = res.shared && res.shared.files[0];
  check(`${label}: share あり（モック）→ 画像ファイル＋文面で共有、フォールバックしない`,
    res.r.mode === 'shared' && res.opened === 0 && f && f.name === 'okonomiyaki.png' && f.type === 'image/png' && f.size === res.blobSize && res.shared.text === expectText,
    JSON.stringify(res.shared));
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = {};

  // ---- 1. 成功ルート（中サイズ）：サイズ選択 → 焼き中 → 空中 → 着地 → 仕上げ → 完成写真
  log('Run 1: 成功（540ml を直径19cmへ）');
  let page = await newPage(browser);
  await shot(page, '00_pour_empty');
  await checkNoShareTouch(page, '読み込み→生地フェーズ');
  await prepare(page, 540, 19, '01');
  await cookTo(page, 0.45);
  await shot(page, '02_cooking');
  await waitFor(page, () => window.__oko.info().d >= 0.68);
  let f = await flipWith(page, ({ size, d }) => { const w = OkoLogic.flipWindow(size, d); return { speed: w.center.speed, angle: w.center.angle }; });
  await waitFor(page, () => window.__oko.phase === 'flight');
  await waitFor(page, () => { const i = window.__oko.info(); return i.discRot < -1.2; });
  await shot(page, '03_flip_midair');
  await waitFor(page, () => window.__oko.phase === 'result');
  results.success = await report(page, '成功ルート', f.intended);
  await shot(page, '04_result_success');
  await page.click('#rBtn');
  await waitFor(page, () => window.__oko.phase === 'bake');
  await sleep(700);
  await shot(page, '04b_bake');
  await waitFor(page, () => window.__oko.phase === 'finish');
  await sleep(1500);
  await shot(page, '05_finish_before');
  // 仕上げ：ソースを塗る、マヨを格子に、鰹節と青のりを散らす（すべて実ドラッグ）
  const r = await page.evaluate(() => window.__oko.appRect());
  const cx = r.x + r.w / 2, cy = r.y + r.h * 0.47, R = r.w * 0.36;
  async function drag(pts) { await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); for (const p of pts.slice(1)) { await page.mouse.move(p[0], p[1], { steps: 4 }); } await page.mouse.up(); }
  await page.click('.tool[data-tool="sauce"]');
  for (let k = -3; k <= 3; k++) await drag([[cx - R * 0.8, cy + k * R * 0.22], [cx + R * 0.8, cy + k * R * 0.22]]);
  await page.click('.tool[data-tool="mayo"]');
  for (let k = -3; k <= 3; k++) await drag([[cx - R * 0.75 + k * R * 0.25, cy - R * 0.75], [cx + R * 0.75 + k * R * 0.25, cy + R * 0.75]]);
  for (let k = -3; k <= 3; k++) await drag([[cx + R * 0.75 + k * R * 0.25, cy - R * 0.75], [cx - R * 0.75 + k * R * 0.25, cy + R * 0.75]]);
  await page.click('.tool[data-tool="aonori"]');
  await drag([[cx - R * 0.6, cy - R * 0.2], [cx, cy + R * 0.3], [cx + R * 0.6, cy - R * 0.1]]);
  await page.click('.tool[data-tool="katsuo"]');
  await drag([[cx - R * 0.5, cy + R * 0.3], [cx, cy - R * 0.3], [cx + R * 0.4, cy + R * 0.2], [cx - R * 0.1, cy + R * 0.5]]);
  await sleep(300);
  await shot(page, '06_finish_decorated');
  const fl1 = (await page.evaluate(() => window.__oko.info())).flakes;
  const sum1 = await page.evaluate(() => { const c = document.getElementById('stage'); return c.toDataURL().length; });
  await sleep(400);
  await shot(page, '06b_finish_katsuo_dance');
  log('  鰹節の枚数', fl1);
  await page.click('#done');
  await sleep(900);
  await shot(page, '07_photo');
  {
    const g = await page.evaluate(() => { const q = s => document.querySelector(s).getBoundingClientRect(); const p = q('.polaroid'), x = q('#pShare'), m = q('#pMsg'), a = q('#again'); return { pBottom: p.bottom, xTop: x.top, xBottom: x.bottom, mTop: m.top, mBottom: m.bottom, aTop: a.top }; });
    check('完成写真(07): Xボタン・案内・もう一度が写真と重ならず縦に並ぶ', g.pBottom <= g.xTop && g.xBottom <= g.mTop && g.mBottom <= g.aTop, JSON.stringify(g));
  }
  {
    await checkNoShareTouch(page, '読み込み→生地→…→完成写真');
    const i = await page.evaluate(() => window.__oko.info());
    const want = `直径${(i.size.diameter * 100).toFixed(1)}cm・厚さ${(i.size.thickness * 100).toFixed(1)}cmのお好み焼き、ひっくり返し成功！ スコア${i.score} #お好み焼きひっくり返せ`;
    await checkWebShareMock(page, '#pShare', '完成写真', want);
    const r = await checkShareBlob(page, '完成写真', '#photoImg');
    check('完成写真: 投稿文が結果どおり（成功版）', r.text === want, r.text);
    await checkFallback(page, '#pShare', '完成写真', want);
    await sleep(300);
    await shot(page, '07b_photo_share_fallback');
    for (const nm of ['07b']) {
      const g = await page.evaluate(() => { const q = s => document.querySelector(s).getBoundingClientRect(); const p = q('.polaroid'), x = q('#pShare'), m = q('#pMsg'), a = q('#again'); return { pBottom: p.bottom, xTop: x.top, xBottom: x.bottom, mTop: m.top, mBottom: m.bottom, aTop: a.top }; });
      check(`完成写真(${nm}): Xボタン・案内・もう一度が写真と重ならず縦に並ぶ`, g.pBottom <= g.xTop && g.xBottom <= g.mTop && g.mBottom <= g.aTop, JSON.stringify(g));
    }
  }
  await page.close();

  // ---- 2. 大失敗ルート（大・生焼け・弱すぎるフリック）
  log('Run 2: 大失敗（450ml を直径24cmへ薄く）');
  page = await newPage(browser);
  await prepare(page, 450, 24, '08pre');
  await cookTo(page, 0.3);
  f = await flipWith(page, ({ size, d }) => { const w = OkoLogic.flipWindow(size, d); return { speed: w.center.speed + w.width.speed * (w.collapseAt + 1.5), angle: w.center.angle - 6 }; });
  await waitFor(page, () => window.__oko.info().particles > 0);
  await sleep(120);
  await shot(page, '08_collapse_burst');
  await sleep(500);
  await shot(page, '09_collapse_splatter');
  await sleep(1800);
  await shot(page, '09b_collapse_landed_ingredients');
  log('  粒子の内訳', JSON.stringify((await page.evaluate(() => window.__oko.info())).kinds));
  await waitFor(page, () => window.__oko.phase === 'result');
  results.collapse = await report(page, '大失敗ルート', f.intended);
  await shot(page, '10_result_collapse');
  {
    await checkNoShareTouch(page, '大失敗の結果画面');
    await checkFallback(page, '#rShare', '大失敗', await page.evaluate(() => window.__oko.shareText()));
    const r = await checkShareBlob(page, '大失敗', null);
    const i = results.collapse;
    check('大失敗: 投稿文がぶちまけ版', /ぶちまけ/.test(r.text) && !/成功/.test(r.text) && r.text.includes(`直径${(i.size.diameter * 100).toFixed(1)}cm`) && r.text.endsWith(`スコア${i.score} #お好み焼きひっくり返せ`), r.text);
    await sleep(300);
    await shot(page, '10b_result_collapse_share_fallback');
    await checkFailureDisables(page, '#rShare', '大失敗');
    await shot(page, '10c_result_collapse_share_disabled');
    await page.click('#rBtn');
    await waitFor(page, () => window.__oko.phase === 'pour', null, 10000);
    check('大失敗: 共有を無効化した後も「もう一度」で生地フェーズへ進める', true);
  }
  await page.close();

  // ---- 3. 惜しいルート（小・少し速すぎ）
  log('Run 3: 惜しい（650ml をほぼ広げず厚く）');
  page = await newPage(browser);
  await prepare(page, 650, 15.5, null);
  await cookTo(page, 0.62);
  f = await flipWith(page, ({ size, d }) => { const w = OkoLogic.flipWindow(size, d); return { speed: w.center.speed + w.width.speed * (1 + (w.collapseAt - 1) * 0.5), angle: w.center.angle }; });
  await waitFor(page, () => window.__oko.phase === 'landed');
  await sleep(700);
  await shot(page, '11_near_fold');
  await waitFor(page, () => window.__oko.phase === 'result');
  results.near = await report(page, '惜しいルート', f.intended);
  await shot(page, '12_result_near');
  check('惜しい: 結果シートにはXボタンを出さない（完成写真で投稿）', await page.evaluate(() => getComputedStyle(document.getElementById('rShare')).display === 'none'));
  await page.close();

  await browser.close();
  log('\nJS errors:', errors.length ? errors : 'none');
  const expect = { success: 'success', collapse: 'collapse', near: 'near' };
  log('Layout issues:', layoutIssues.length ? layoutIssues : 'none');
  const shareFail = shareChecks.filter(c => !c.ok);
  log(`Share checks: ${shareChecks.length - shareFail.length}/${shareChecks.length} pass`, shareFail.length ? shareFail.map(c => c.name) : '');
  let ok = errors.length === 0 && layoutIssues.length === 0 && shareFail.length === 0;
  for (const k in expect) if (results[k].judgement.tier !== expect[k]) { ok = false; log('UNEXPECTED tier for', k, results[k].judgement.tier); }
  log(ok ? 'SCREENS OK' : 'SCREENS FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); console.log('JS errors:', errors); process.exit(1); });
