// 「お好み焼き、ひっくり返せ！」の告知動画の台本（npm run promo）。
// つかみ：大失敗で具材が飛び散る瞬間（スロー）→ タイトル → 注ぐ → 広げる → 焼く（早送り）→ フリックで成功 → 点数 → 仕上げ → 写真 → エンドカード
// ゲーム側の入口は src/game.html の window.__game（スキル promo-video の references/game-hooks.md の約束）。

export const config = {
  slug: 'okonomiyaki',
  url: 'https://game.chozo.net/okonomiyaki/',
  orientation: 'portrait',
  game: { width: 390, height: 693 }, // ゲームは 9:16
  serveDir: 'dist',
  gamePath: '/okonomiyaki/',
  music: { file: 'tools/promo/bgm.wav', volume: 0.22 }, // 効果音より約14dB小さく
};

const GW = 390, GH = 693;
const FPS = 30;

// ---- 準備の部品 ----
async function pourTo(p, ml, { record }) { // 「生地を落とす」を長押しして ml まで注ぐ
  await p.call('pour', true);
  const ok = await p.until((s) => s.volume * 1e6 >= ml, { max: 12, record });
  await p.call('pour', false);
  return ok;
}
async function spreadTo(p, cm, { record, maxSec = 8, step = 0.3 }) { // 生地のふちをぐるぐるなぞって直径 cm まで広げる
  let s = await p.state(), ang = 0;
  const pt = () => [s.disc.x + Math.cos(ang) * s.disc.r * 0.95, s.disc.y + Math.sin(ang) * s.disc.r * 0.95 * 0.8];
  await p.call('touchDown', ...pt());
  for (let i = 0; i < maxSec * FPS; i++) {
    s = await p.state();
    if (s.diameter * 100 >= cm) break;
    for (let k = 0; k < 3; k++) { ang += step; await p.call('touchMove', ...pt()); }
    if (record) await p.wait(1 / FPS); else await p.skip(1 / FPS);
  }
  await p.call('touchUp');
}
async function cookTo(p, percent, { record }) { // 焼き加減が percent% になるまで焼く
  await p.call('click', 'cookBtn');
  await p.until((s) => s.percent >= percent, { max: 20, record });
  await p.call('click', 'flipBtn');
  await p.until((s) => s.phase === 'flipReady', { max: 3, record });
}
async function flick(p, kSpeed, dAngle = 0, eNear = 0) { // 成功の窓の中心に対して速さを kSpeed 倍・角度を dAngle 度ずらしてフリック
  const w = await p.call('flipWindow');
  if (eNear) kSpeed = 1 + (w.width.speed * (1 + eNear * (w.collapseAt - 1))) / w.center.speed; // 惜しい：窓の外・崩れる手前（0〜1 の割合）
  const n = 5, ms = (n / FPS) * 1000;
  const sw = await p.call('swipeFor', w.center.speed * kSpeed, w.center.angle + dAngle, ms);
  const x0 = GW * 0.3, y0 = GH * 0.86;
  await p.drag([[x0, y0], [x0 + sw.dx, y0 + sw.dy]], n / FPS);
}

export default async function scenario(p) {
  await p.seed(20261121);

  // ---- 0〜2.5秒 つかみ：大失敗！具材が飛び散る（スロー）
  await p.call('click', 'startBtn');
  await pourTo(p, 420, { record: false });
  await spreadTo(p, 26, { record: false });
  await cookTo(p, 60, { record: false });
  p.on('explode', () => { p.flash({ strength: 0.8 }); p.shake(16, 0.5); p.fx('ドバーッ！', { x: 0.5, y: 0.58, size: 84, dur: 1.2, rot: -8 }); });
  p.zoom(1.12, 0.01, { x: 0.5, y: 0.45 });
  await flick(p, 2.1, 10);
  p.speed(0.7, { badge: false });
  await p.until((s, ev) => ev.some((e) => e.type === 'explode'), { max: 3 });
  p.zoom(1, 1.4);
  await p.wait(0.45);
  p.cover(); // 表紙は具材が飛び散る瞬間
  await p.wait(0.95);
  p.speed(1);

  // ---- タイトルと一言（具材が散らばった鉄板の上に重ねる）
  p.title({ title: 'お好み焼き、\nひっくり返せ！', sub: '焼いて、フリックで返す！', dur: 2.8 });
  await p.wait(3.0);
  p.off('explode');

  // ---- 惜しい失敗：強すぎて端が折れる（準備は撮らない）
  await p.call('newRound');
  await pourTo(p, 480, { record: false });
  await spreadTo(p, 21, { record: false });
  await cookTo(p, 92, { record: false });
  await p.skip(0.3);
  p.caption('力加減がむずかしい！', { y: 0.2, dur: 2.4 });
  await p.wait(0.6);
  await flick(p, 1, 0, 0.35);
  p.on('land', (e) => { if (e.tier === 'near') { p.shake(8, 0.3); p.fx('ベチャッ…', { x: 0.5, y: 0.58, size: 70, dur: 1.2, rot: -6, color: '#ffd0a0' }); } });
  await p.until((s) => s.phase === 'landed', { max: 4 });
  await p.wait(1.4);
  p.off('land');

  // ---- 実際のプレイ：注ぐ → 広げる → 焼く → 返す
  await p.call('newRound');
  await p.skip(0.3);
  p.caption('生地を注いで', { y: 0.36, dur: 1.6 });
  p.speed(2.5, { badge: false });
  await pourTo(p, 540, { record: true });
  p.speed(1);
  await p.skip(0.25);
  p.caption('ぐるぐる広げて', { y: 0.36, dur: 1.9 });
  p.fx('ぐ〜るぐる', { x: 0.5, y: 0.7, size: 54, dur: 1.4, rot: -6 });
  await spreadTo(p, 19.5, { record: true, maxSec: 3, step: 0.13 });
  await p.wait(0.4);

  p.speed(4);
  p.caption('焼き色を見極めて', { y: 0.2, dur: 2.4 });
  p.fx('ジュ〜ッ！', { x: 0.5, y: 0.62, size: 64, dur: 1.2, rot: 6 });
  await cookTo(p, 100, { record: true });
  p.speed(1);

  p.caption('フリックで返す！', { y: 0.2, dur: 1.3 });
  await p.wait(0.5);
  p.on('flick', () => p.fx('えいっ！', { x: 0.62, y: 0.55, size: 70, dur: 0.8, rot: -10 }));
  await flick(p, 1.0, 0);
  // 宙を舞う瞬間はスローで
  p.speed(0.5, { badge: false });
  p.on('land', () => { p.shake(10, 0.3); p.fx('クルッ！', { x: 0.5, y: 0.4, size: 90, dur: 1.0, rot: 8 }); });
  await p.until((s) => s.phase === 'landed', { max: 4 });
  p.speed(1);
  p.on('result', (e) => { p.flash({ strength: 0.5 }); p.caption(`${e.score}点！`, { y: 0.2, size: 76, dur: 1.6, color: '#ffe14d' }); });
  await p.until((s) => s.phase === 'result', { max: 3 });
  await p.wait(2.0);

  // ---- 仕上げ：ソースとマヨネーズ（早送り）→ 写真
  await p.call('click', 'rBtn'); // 裏面を焼く
  await p.skip(3.4); // 裏面が焼けて仕上げへ（撮らない）
  await p.skip(0.8);
  let s = await p.state();
  const zig = (cx, cy, r, rows) => {
    const pts = [];
    for (let i = 0; i <= rows; i++) { const y = cy - r * 0.6 + (r * 1.2 * i) / rows; const w = r * Math.sqrt(Math.max(0, 1 - ((y - cy) / r) ** 2)) * 0.85; pts.push(i % 2 ? [cx + w, y] : [cx - w, y]); }
    return pts;
  };
  p.caption('ソースとマヨで\n仕上げ！', { y: 0.2, dur: 2.2 });
  await p.call('tool', 'sauce');
  await p.drag(zig(s.disc.x, s.disc.y, s.disc.r, 6), 0.8);
  await p.call('tool', 'mayo');
  const z2 = zig(s.disc.x, s.disc.y, s.disc.r * 0.92, 9).map(([x, y]) => [x, y + 4]);
  await p.drag(z2, 1.1);
  await p.call('tool', 'aonori');
  await p.drag([[s.disc.x - s.disc.r * 0.5, s.disc.y], [s.disc.x + s.disc.r * 0.5, s.disc.y - s.disc.r * 0.2]], 0.4);
  await p.call('tool', 'katsuo');
  p.fx('かつお節\nゆらゆら〜', { x: 0.5, y: 0.66, size: 50, dur: 1.6, rot: -5 });
  await p.drag([[s.disc.x - s.disc.r * 0.6, s.disc.y + s.disc.r * 0.2], [s.disc.x, s.disc.y - s.disc.r * 0.4], [s.disc.x + s.disc.r * 0.6, s.disc.y + s.disc.r * 0.1]], 0.9);
  await p.wait(0.7);

  await p.call('click', 'done');
  p.flash({ strength: 0.9 });
  p.fx('パシャッ！', { x: 0.5, y: 0.3, size: 70, dur: 0.9, rot: -6 });
  await p.wait(0.6);
  p.caption('焼き上がり！', { y: 0.2, size: 64, dur: 2.0 });
  await p.wait(2.2);

  // ---- エンドカード（最後のコマが表紙）
  p.endCard({ title: 'お好み焼き、\nひっくり返せ！', sub: 'スマホでもPCでも', cta: '今すぐ遊べる！' });
  await p.wait(3.2);
}
