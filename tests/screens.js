// 画面確認：実際のクリック・スワイプ・ドラッグで遊び、各場面のスクリーンショットを撮る。
// 実行: node tests/screens.js   （先に npm run build。playwright-core とインストール済み Chrome を使用）
// 出力: tests/screenshots/*.png（リポジトリに含めない）
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
        texts.push({ q, who, node: n, tilted: !!n.parentElement.closest('.logo') });
        const tol = 1;
        if (q.left < app.left - tol || q.right > app.right + tol || q.top < app.top - tol || q.bottom > app.bottom + tol) out.push('off-screen: ' + who);
        if (box) { const b = box.getBoundingClientRect(); if (q.left < b.left - tol || q.right > b.right + tol || q.top < b.top - tol || q.bottom > b.bottom + tol) out.push('outside ' + label(box) + ': ' + who); }
      }
    }
    // 文字どうしの重なり（2px 以上食い込んだら NG）
    // タイトルのロゴ（.logo）は意図して -3° 傾けており、傾いた字の外接矩形どうしが隣の字と重なるので重なり判定から外す（画面外の判定はする）
    for (let i = 0; i < texts.length; i++) for (let k = i + 1; k < texts.length; k++) {
      if (texts[i].tilted && texts[k].tilted) continue;
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
      if (el.id === 'title' && el.scrollWidth - el.clientWidth <= 4) continue; // 傾けたロゴの外接矩形ぶん（数px）だけ広がる。字が画面外に出ていないことは上で確認済み
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

// ---- 画面のふるまいの確認（成否を集計する）
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; }, sel);
// 採点の内訳（100点から引く）の合計が表示中の点数と一致するか
async function checkBreakdown(page, label) {
  const i = await page.evaluate(() => window.__oko.info()), b = i.breakdown;
  const want = i.judgement.tier === 'collapse' ? 0 : Math.max(0, 100 - b.flick - b.doneness - b.thin);
  const shownScore = await page.evaluate(() => parseInt(document.querySelector('#rScore .sc').textContent, 10));
  check(`${label}: 点数＝100−減点の合計（${i.score}点）`, i.score === want && shownScore === i.score, JSON.stringify(b));
}
// X 共有は撤去済み（2026-11-20）。共有ボタンや共有APIの呼び出しが残っていないこと
async function checkNoShare(page, label) {
  const r = await page.evaluate(() => ({ btn: !!document.querySelector('#pShare, #rShare, [data-share]'), fn: typeof (window.__oko && window.__oko.shareText) }));
  check(`${label}: X 共有のボタン・関数が無い`, !r.btn && r.fn === 'undefined', JSON.stringify(r));
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = {};

  // ---- 1. 成功ルート（中サイズ）：注いで広げる → 焼き中 → 空中 → 着地 → 仕上げ → 完成写真
  log('Run 1: 成功（540ml を直径19cmへ）');
  let page = await newPage(browser);
  await shot(page, '00_pour_empty');
  await checkNoShare(page, '生地フェーズ');
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
  await checkBreakdown(page, '成功');
  check('成功: 採点画面に「タイトルへ」を出さない（裏面へ続く）', !(await shown(page, '#rToTitle')));
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
  await sleep(400);
  await shot(page, '06b_finish_katsuo_dance');
  log('  鰹節の枚数', fl1);
  await page.click('#done');
  await sleep(900);
  await shot(page, '07_photo');
  {
    const g = await page.evaluate(() => { const q = s => document.querySelector(s).getBoundingClientRect(); const p = q('.polaroid'), a = q('#again'), t = q('#pToTitle'); return { pBottom: p.bottom, aTop: a.top, aBottom: a.bottom, tTop: t.top }; });
    check('完成写真: 写真・もう一度焼く・タイトルへが重ならず縦に並ぶ', g.pBottom <= g.aTop && g.aBottom <= g.tTop, JSON.stringify(g));
    // 消音ボタン：押すと master の音量が 0 になり、もう一度押すと戻る
    await page.click('#muteBtn');
    const m1 = await page.evaluate(() => window.__oko.audio());
    await page.click('#muteBtn');
    const m2 = await page.evaluate(() => window.__oko.audio());
    check('消音ボタン: 消音↔音ありが切り替わる', m1.muted === true && m2.muted === false, JSON.stringify({ m1, m2 }));
    await page.click('#pToTitle');
    await waitFor(page, () => window.__oko.phase === 'title', null, 10000);
    await sleep(500);
    await shot(page, '07c_back_to_title');
    check('完成写真: 「タイトルへ」でタイトル画面に戻る', true);
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
    await checkBreakdown(page, '大失敗');
    check('大失敗: 採点画面に「タイトルへ」を出す', await shown(page, '#rToTitle'));
    check('大失敗: 結果シートが小さい（compact）', await page.evaluate(() => document.getElementById('result').classList.contains('compact')));
    await page.click('#rBtn');
    await waitFor(page, () => window.__oko.phase === 'pour', null, 10000);
    check('大失敗: 「もう一度」で生地フェーズへ進める', true);
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
  await checkBreakdown(page, '惜しい');
  check('惜しい: 採点画面に「タイトルへ」を出さない（裏面へ続く）', !(await shown(page, '#rToTitle')));
  await page.close();

  await browser.close();
  log('\nJS errors:', errors.length ? errors : 'none');
  const expect = { success: 'success', collapse: 'collapse', near: 'near' };
  log('Layout issues:', layoutIssues.length ? layoutIssues : 'none');
  const failed = checks.filter(c => !c.ok);
  log(`Checks: ${checks.length - failed.length}/${checks.length} pass`, failed.length ? failed.map(c => c.name) : '');
  let ok = errors.length === 0 && layoutIssues.length === 0 && failed.length === 0;
  for (const k in expect) if (results[k].judgement.tier !== expect[k]) { ok = false; log('UNEXPECTED tier for', k, results[k].judgement.tier); }
  log(ok ? 'SCREENS OK' : 'SCREENS FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); console.log('JS errors:', errors); process.exit(1); });
