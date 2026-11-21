// OGP画像（public/ogp.png、1200×630）を作る： npm run ogp
//  1. 実際のゲーム（index.html）をインストール済み Chrome で開き、生地を注いで広げ、
//     ちょうどよい焼き加減で成功フリック → お好み焼きが宙を舞う瞬間を UI を隠して撮る
//  2. その絵を背景に、タイトル・一言の遊び方・公開URLを左に重ねて 1200×630 で書き出す
// 乱数は固定しているが、撮る瞬間はフレームの進み具合で少し変わるため、毎回わずかに違う絵になる。
// 先に `npm run build` で dist/okonomiyaki/index.html を作っておくこと。
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = require('playwright-core');
const OUT = path.join(APP, 'public/ogp.png');
const URL_TEXT = 'game.chozo.net/okonomiyaki';
const OG_W = 1200, OG_H = 630;
const VIEW_W = 1500, VIEW_H = Math.round(VIEW_W * 16 / 9); // ゲームは 9:16。大きく描いて横長に切り抜く

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, arg, timeout = 60000) { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-ogp-'));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  // ---- 1. ゲーム画面を撮る
  const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
  await page.addInitScript(() => { // 乱数を固定（具材・泡・湯気の配置をなるべく同じにする）
    let s = 20261121; Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  });
  await page.goto(pathToFileURL(path.join(APP, 'dist/okonomiyaki/index.html')).href + '?fixedpr');
  await waitFor(page, () => window.__oko && window.__oko.phase === 'title');
  await page.click('#startBtn', { force: true });
  await waitFor(page, () => window.__oko.phase === 'pour');

  // 生地を 540ml 落として直径 19cm へ広げる（中くらいのお好み焼き）
  const b = await page.locator('#pourBtn').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await waitFor(page, v => window.__oko.info().shape.volume * 1e6 >= v, 515);
  await page.mouse.up(); await sleep(250);
  let c = await page.evaluate(() => window.__oko.discScreen()), ang = 0;
  const pt = () => [c.x + Math.cos(ang) * c.r * 0.95, c.y + Math.sin(ang) * c.r * 0.95 * 0.8];
  await page.mouse.move(...pt()); await page.mouse.down();
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => window.__oko.info().shape.diameter * 100) >= 19) break;
    if (i % 6 === 0) c = await page.evaluate(() => window.__oko.discScreen());
    ang += 0.45; await page.mouse.move(...pt());
  }
  await page.mouse.up(); await sleep(200);

  // こんがり（最適）まで焼いて、判定窓の中心で返す
  await page.click('#cookBtn');
  await waitFor(page, () => window.__oko.info().d >= 0.68, null, 120000);
  await page.click('#flipBtn');
  await waitFor(page, () => window.__oko.phase === 'flipReady');
  await page.evaluate(async () => {
    const i = window.__oko.info(), w = OkoLogic.flipWindow(i.size, i.flipD), f = { speed: w.center.speed, angle: w.center.angle };
    const H = window.__oko.viewH(), r = window.__oko.appRect(), sw = OkoLogic.swipeForFlick(f, 100, H), vx = sw.dx / 100, vy = sw.dy / 100;
    const x0 = r.x + r.w * 0.3, y0 = r.y + r.h * 0.86, st = document.getElementById('stage');
    const ev = (t, x, y) => st.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true }));
    ev('pointerdown', x0, y0); const t0 = performance.now(); let el = 0;
    while (el < 160) { await new Promise(res => setTimeout(res, 8)); el = performance.now() - t0; ev('pointermove', x0 + vx * el, y0 + vy * el); }
    ev('pointerup', x0 + vx * el, y0 + vy * el);
  });
  await waitFor(page, () => window.__oko.phase === 'flight');
  await waitFor(page, () => window.__oko.info().discRot < -1.0); // 宙で立ち上がった瞬間
  await page.addStyleTag({ content: '#ui, #fx { display:none !important; }' });
  const disc = await page.evaluate(() => window.__oko.discCenter());
  const app = await page.evaluate(() => window.__oko.appRect());
  const shot = path.join(tmp, 'scene.png');
  await page.screenshot({ path: shot, clip: { x: app.x, y: app.y, width: app.w, height: app.h } });
  if (process.env.OGP_DEBUG) fs.copyFileSync(shot, process.env.OGP_DEBUG); // 切り抜き前の全体（調整用）
  await page.close();

  // ---- 2. 縮小して配置し、文字を重ねる（宙のお好み焼きを右寄り、文字を左）
  const K = 0.8, DISC_AT = { x: 905, y: 318 };           // 縮小率と、お好み焼きの中心を置く位置
  const bw = Math.round(app.w * K), bh = Math.round(app.h * K);
  const ox = Math.round(disc.x * K - DISC_AT.x), oy = Math.round(disc.y * K - DISC_AT.y); // 背景の左上を (-ox, -oy) に置く
  const bg = 'data:image/png;base64,' + fs.readFileSync(shot).toString('base64');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin:0; }
    #c { position:relative; width:${OG_W}px; height:${OG_H}px; overflow:hidden; font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans CJK JP",sans-serif;
      background:#0b0604 url(${bg}) ${-ox}px ${-oy}px / ${bw}px ${bh}px no-repeat; }
    #c::before { content:""; position:absolute; inset:0;
      background:linear-gradient(90deg, rgba(11,6,4,1) 0%, rgba(11,6,4,.97) ${Math.max(0, -ox) + 20}px, rgba(11,6,4,.55) 50%, rgba(11,6,4,0) 64%); }
    .t { position:absolute; left:64px; top:92px; }
    .l1 { display:block; font-size:62px; font-weight:900; color:#fff4dc; letter-spacing:.04em; text-shadow:0 4px 0 #6b2c0e, 0 8px 16px rgba(0,0,0,.6); }
    .l2 { display:block; margin-top:10px; font-size:100px; font-weight:900; color:#ffd27a; white-space:nowrap; line-height:1.05;
      text-shadow:0 7px 0 #c4321a, 0 14px 0 #6b1c08, 0 22px 26px rgba(0,0,0,.7); }
    .how { margin-top:42px; font-size:32px; font-weight:800; color:#fff4dc; line-height:1.5; text-shadow:0 2px 8px #000; }
    .url { position:absolute; left:64px; bottom:56px; padding:10px 26px; border-radius:999px; background:#e8542b; color:#fff;
      font-size:30px; font-weight:800; letter-spacing:.02em; box-shadow:0 5px 0 #7c1f08; }
  </style><div id="c"><div class="t"><span class="l1">お好み焼き、</span><span class="l2">ひっくり返せ！</span>
    <div class="how">生地を注いで広げ、焼き色を見極めて、<br>フリックで豪快に返す！</div></div>
    <div class="url">${URL_TEXT}</div></div>`;
  const comp = await browser.newPage({ viewport: { width: OG_W, height: OG_H }, deviceScaleFactor: 1 });
  await comp.setContent(html); await sleep(300);
  await comp.locator('#c').screenshot({ path: OUT });
  console.log(`wrote ${path.relative(APP, OUT)} (${OG_W}×${OG_H}, disc at ${Math.round(disc.x * K - ox)},${Math.round(disc.y * K - oy)})`);
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
