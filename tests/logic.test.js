// 純ロジックの単体テスト： node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');
const OPT = L.OPT_DONENESS;
const cm3 = v => v * 1e-6, cm = x => x / 100;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// 代表的な「実測の形」：体積と直径から作る（プリセットではない）
//  thin  ＝ 450cm³ を直径24cmに広げた（≈1.0cm）
//  mid   ＝ 540cm³ を直径19cmに広げた（≈1.9cm）
//  thick ＝ 600cm³ を直径15cmにとどめた（≈3.4cm）
const SIZES = {
  L: L.makeSize(cm3(450), cm(24)),
  M: L.makeSize(cm3(540), cm(19)),
  S: L.makeSize(cm3(600), cm(15))
};

// 窓の外側の一定範囲を格子状に走査し、各段階の割合を返す
function tierRates(size, d) {
  const n = { success: 0, near: 0, collapse: 0 }; let total = 0;
  for (let v = 0.5; v <= 6.0; v += 0.05) for (let a = 20; a <= 90; a += 1) {
    n[L.judge(size, d, { speed: v, angle: a }).tier]++; total++;
  }
  return { success: n.success / total, near: n.near / total, collapse: n.collapse / total };
}

test('厚み＝体積÷面積：体積と直径から物理的に決まる', () => {
  // 500cm³ を直径20cm → 面積 314.16cm² → 厚み 1.5915cm
  const s = L.makeSize(cm3(500), cm(20));
  assert.ok(near(s.thickness, cm3(500) / (Math.PI * 0.1 * 0.1)));
  assert.ok(near(s.thickness * 100, 1.5915, 1e-4));
  // 体積を2倍 → 厚み2倍、直径を2倍 → 厚み1/4
  assert.ok(near(L.makeSize(cm3(1000), cm(20)).thickness, s.thickness * 2));
  assert.ok(near(L.makeSize(cm3(500), cm(40)).thickness, s.thickness / 4));
  // 体積は保存される（厚み×面積＝体積）
  assert.ok(near(s.thickness * L.area(s.diameter), cm3(500)));
  // 質量は体積×密度
  assert.ok(near(L.mass(s), 900 * cm3(500)));
});

test('たくさん落として狭く＝厚い、少なく落として広く＝薄い', () => {
  const many_narrow = L.makeSize(cm3(900), cm(15));
  const few_wide = L.makeSize(cm3(300), cm(25));
  assert.ok(many_narrow.thickness > cm(4.5) && few_wide.thickness < cm(0.7));
  assert.ok(L.thicknessNorm(many_narrow) === 1 && L.thicknessNorm(few_wide) === 0);
  // 代表サイズは直径が大きいほど薄い
  assert.ok(SIZES.L.thickness < SIZES.M.thickness && SIZES.M.thickness < SIZES.S.thickness);
  assert.ok(near(SIZES.L.thickness * 100, 0.995, 0.01) && near(SIZES.S.thickness * 100, 3.395, 0.01));
});

test('落とす：長押しほど速く出る、落としたままの生地は分厚い水たまり', () => {
  assert.ok(L.pourRate(0) < L.pourRate(0.7) && L.pourRate(0.7) < L.pourRate(2));
  assert.ok(near(L.pourRate(5), L.POUR.rateMax));
  let sh = { volume: 0, diameter: 0 };
  for (let i = 0; i < 100; i++) sh = L.pourStep(sh, cm3(5)); // 500cm³
  assert.ok(near(sh.volume, cm3(500)));
  assert.ok(near(L.thicknessFrom(sh.volume, sh.diameter), L.POUR.hPuddle, 1e-9));
  // ボウルの容量を超えては落ちない
  for (let i = 0; i < 1000; i++) sh = L.pourStep(sh, cm3(5));
  assert.ok(near(sh.volume, L.POUR.vMax));
});

test('広げる：体積は変わらず直径が増え、厚みが減る。薄くなりすぎない', () => {
  let sh = L.pourStep({ volume: 0, diameter: 0 }, cm3(500));
  const h0 = L.thicknessFrom(sh.volume, sh.diameter);
  const s1 = L.spreadStep(sh, 3);
  assert.ok(near(s1.volume, sh.volume) && s1.diameter > sh.diameter);
  assert.ok(L.thicknessFrom(s1.volume, s1.diameter) < h0);
  // 何周回しても下限（切れる厚み）か鉄板の幅で止まる
  let s = sh; for (let i = 0; i < 2000; i++) s = L.spreadStep(s, 1);
  assert.ok(s.atMax);
  assert.ok(L.thicknessFrom(s.volume, s.diameter) >= L.SPREAD.hMin - 1e-12);
  assert.ok(s.diameter <= L.SPREAD.dMax + 1e-12);
  // 薄いほど広がりにくい（同じ1周で増える直径が小さい）
  const thickGrow = L.spreadStep(sh, 1).diameter - sh.diameter;
  const thinSh = { volume: sh.volume, diameter: cm(26) };
  const thinGrow = L.spreadStep(thinSh, 1).diameter - thinSh.diameter;
  assert.ok(thinGrow < thickGrow);
  // 広げた後に足すと、直径は変わらず厚くなる
  const wide = { volume: cm3(300), diameter: cm(22) };
  const added = L.pourStep(wide, cm3(200));
  assert.ok(near(added.diameter, cm(22)) && L.thicknessFrom(added.volume, added.diameter) > L.thicknessFrom(wide.volume, wide.diameter));
});

test('同じ量でも広げ方で窓が変わる：広げて薄く→窓が広い・崩れやすい、狭く厚く→窓が狭い・崩れにくい', () => {
  const V = cm3(500);
  const wideThin = L.makeSize(V, cm(24)), narrowThick = L.makeSize(V, cm(14));
  const wT = L.flipWindow(wideThin, OPT), wN = L.flipWindow(narrowThick, OPT);
  assert.ok(wT.width.speed > wN.width.speed);
  assert.ok(wT.collapseAt < wN.collapseAt);
  // 厚みは連続量：直径を1cmずつ広げるごとに窓（速さ方向）は単調に広がる
  let prev = -Infinity;
  for (let d = 13; d <= 26; d++) { const w = L.flipWindow(L.makeSize(V, cm(d)), OPT).width.speed; assert.ok(w >= prev); prev = w; }
  // 同じ直径で量を増やす（厚くする）と窓が狭まり、薄さの減点が減る（最高点が上がる）
  const a = L.makeSize(cm3(300), cm(18)), b = L.makeSize(cm3(700), cm(18));
  assert.ok(L.flipWindow(a, OPT).width.speed > L.flipWindow(b, OPT).width.speed);
  assert.ok(L.maxScore(a) < L.maxScore(b));
});

test('同じ厚みなら直径が大きいほど角度の窓が少し狭い', () => {
  const small = L.makeSize(L.area(cm(14)) * cm(1.8), cm(14)), big = L.makeSize(L.area(cm(28)) * cm(1.8), cm(28));
  assert.ok(near(small.thickness, big.thickness));
  assert.ok(L.flipWindow(big, OPT).width.angle < L.flipWindow(small, OPT).width.angle);
  assert.ok(near(L.flipWindow(big, OPT).width.speed, L.flipWindow(small, OPT).width.speed));
});

test('薄いほど成功の窓は広い（速さ・角度とも）', () => {
  const wL = L.flipWindow(SIZES.L, OPT).width, wM = L.flipWindow(SIZES.M, OPT).width, wS = L.flipWindow(SIZES.S, OPT).width;
  assert.ok(wL.speed > wM.speed && wM.speed > wS.speed);
  assert.ok(wL.angle > wM.angle && wM.angle > wS.angle);
  // 走査でも成功率は薄いほど高い
  assert.ok(tierRates(SIZES.L, OPT).success > tierRates(SIZES.S, OPT).success);
});

test('薄いほど崩壊しやすい：強度が低く、崩壊域が広い', () => {
  assert.ok(L.strength(SIZES.L, OPT) < L.strength(SIZES.M, OPT));
  assert.ok(L.strength(SIZES.M, OPT) < L.strength(SIZES.S, OPT));
  const rL = tierRates(SIZES.L, OPT), rS = tierRates(SIZES.S, OPT);
  assert.ok(rL.collapse > rS.collapse, `collapse L=${rL.collapse} S=${rS.collapse}`);
  // 失敗したときに崩壊になる割合も薄いほど高い
  const failL = rL.collapse / (rL.collapse + rL.near), failS = rS.collapse / (rS.collapse + rS.near);
  assert.ok(failL > failS);
});

test('同じだけ窓を外したとき：薄いと崩壊、厚いと「惜しい」で済む', () => {
  for (const delta of [0.7, 1.0]) { // 窓の端から速さを delta m/s 超過
    const res = {};
    for (const k of ['L', 'S']) {
      const w = L.flipWindow(SIZES[k], OPT);
      const flick = { speed: w.center.speed + w.width.speed + delta, angle: w.center.angle };
      res[k] = L.judge(SIZES[k], OPT, flick).tier;
    }
    assert.equal(res.L, 'collapse', `delta=${delta}`);
    assert.equal(res.S, 'near', `delta=${delta}`);
  }
});

test('厚いほど窓は狭いが崩壊しにくい（窓中心は速く・急角度へ）', () => {
  const wL = L.flipWindow(SIZES.L, OPT), wS = L.flipWindow(SIZES.S, OPT);
  assert.ok(wS.width.speed < wL.width.speed);
  assert.ok(wS.collapseAt > wL.collapseAt);
  assert.ok(wS.center.speed > wL.center.speed && wS.center.angle > wL.center.angle);
});

test('焼き加減が両端（生・焦げ）だと窓が狭く、成功率が下がる', () => {
  for (const k of ['L', 'M', 'S']) {
    const s = SIZES[k];
    const mid = L.flipWindow(s, OPT).width.speed;
    assert.ok(L.flipWindow(s, 0.1).width.speed < mid, `${k} raw`);
    assert.ok(L.flipWindow(s, 1.0).width.speed < mid, `${k} burnt`);
    const rMid = tierRates(s, OPT).success;
    assert.ok(tierRates(s, 0.1).success < rMid);
    assert.ok(tierRates(s, 1.0).success < rMid);
  }
  // 窓の広さ係数は適正付近で最大
  const ds = [0, 0.2, 0.4, 0.6, 0.68, 0.8, 0.9, 1.0].map(L.donenessWindowFactor);
  assert.equal(Math.max(...ds), L.donenessWindowFactor(0.68));
});

test('焼きが浅いと強度不足で崩壊しやすい', () => {
  for (const k of ['L', 'M', 'S']) {
    const s = SIZES[k];
    assert.ok(L.strength(s, 0.1) < L.strength(s, OPT));
    assert.ok(tierRates(s, 0.1).collapse > tierRates(s, OPT).collapse, k);
  }
});

test('焦げは強度が落ちない（硬い）が、窓中心がずれて窓が狭い', () => {
  const s = SIZES.M;
  assert.ok(L.strength(s, 1.0) >= L.strength(s, OPT));
  assert.ok(L.flipWindow(s, 1.0).center.speed < L.flipWindow(s, OPT).center.speed);
});

test('判定は3段階：窓中心=成功、少し外=惜しい、大きく外=大失敗', () => {
  for (const k of ['L', 'M', 'S']) {
    const s = SIZES[k], w = L.flipWindow(s, OPT);
    const c = { speed: w.center.speed, angle: w.center.angle };
    const jc = L.judge(s, OPT, c);
    assert.equal(jc.tier, 'success'); assert.equal(jc.flickPenalty, 0);
    const midNear = 1 + (w.collapseAt - 1) / 2;
    assert.equal(L.judge(s, OPT, { speed: c.speed + w.width.speed * midNear, angle: c.angle }).tier, 'near');
    assert.equal(L.judge(s, OPT, { speed: c.speed, angle: c.angle - w.width.angle * (w.collapseAt + 0.2) }).tier, 'collapse');
    assert.equal(L.judge(s, OPT, { speed: 0.3, angle: 10 }).tier, 'collapse');
  }
});

test('スコア：100点満点からの減点。厚く焼いて、こんがりで、窓の中心で返せば100点', () => {
  const perfect = (size, d = OPT) => { const w = L.flipWindow(size, d); return L.score(size, L.judge(size, d, { speed: w.center.speed, angle: w.center.angle })); };
  assert.equal(perfect(L.makeSize(cm3(900), cm(15))), 100);              // 厚さ 5cm 超：減点なし
  assert.ok(perfect(SIZES.L) < perfect(SIZES.M) && perfect(SIZES.M) < perfect(SIZES.S)); // 薄いほど最高点が下がる
  for (const k of ['L', 'M', 'S']) assert.equal(perfect(SIZES[k]), L.maxScore(SIZES[k]));
  // 薄さの減点：3.0cm 以上 0、0.8cm 以下 30、その間は連続
  const th = t => L.thinPenalty(L.makeSize(L.area(cm(18)) * cm(t), cm(18)));
  assert.equal(L.thinPenalty(L.makeSize(cm3(900), cm(15))), 0);
  assert.equal(th(3.0), 0); assert.equal(th(3.3), 0);
  assert.equal(th(2.9), 1);
  assert.equal(th(2.2), 11);
  assert.equal(th(0.8), 30);
  assert.equal(L.thinPenalty(L.makeSize(cm3(300), cm(25))), 30);
  // 返しのずれ：成功（折れずに返せた）0〜15（ずれるほど大きい）、惜しい 40〜70、大失敗は 0 点
  const s = SIZES.M, w = L.flipWindow(s, OPT);
  const at = e => L.judge(s, OPT, { speed: w.center.speed + w.width.speed * e, angle: w.center.angle });
  assert.equal(at(0.5).flickPenalty, 8); assert.equal(at(1).flickPenalty, 15);
  assert.equal(at(1.0001).tier, 'near'); assert.equal(at(1.0001).flickPenalty, 40);
  assert.equal(at(w.collapseAt).flickPenalty, 70);
  const sc = e => L.score(s, at(e));
  assert.ok(sc(0) > sc(0.5) && sc(0.5) > sc(1.5) && sc(1.5) > 0);
  assert.equal(L.score(s, L.judge(s, OPT, { speed: 0.2, angle: 5 })), 0);
  // 内訳の合計と点数が一致する（表示と同じ丸め）
  for (const e of [0, 0.37, 0.8, 1.3, 2]) { const j = at(e), b = L.scoreBreakdown(s, j); assert.equal(b.total, Math.max(0, 100 - b.flick - b.doneness - b.thin)); }
});

test('スワイプ→フリック変換と逆変換が一致する', () => {
  const f = { speed: 3.1, angle: 64 };
  const sw = L.swipeForFlick(f, 100, 700);
  const back = L.flickFromSwipe(sw.dx, sw.dy, 100, 700);
  assert.ok(Math.abs(back.speed - f.speed) < 1e-9 && Math.abs(back.angle - f.angle) < 1e-9);
  assert.ok(L.flickFromSwipe(0, -300, 100, 700).angle === 90);
  assert.ok(L.flickFromSwipe(100, 50, 100, 700).angle < 0); // 下向きスワイプは負角度
});

test('物理：窓中心のフリックでちょうど180°回って前方に着地する', () => {
  for (const k of ['L', 'M', 'S']) {
    const s = SIZES[k], w = L.flipWindow(s, OPT);
    const r = L.simulateFlight(s, OPT, { speed: w.center.speed, angle: w.center.angle });
    assert.ok(Math.abs(Math.abs(r.rot) - Math.PI) < 0.03, `${k} rot=${r.rot}`);
    assert.ok(Math.abs(r.x - 0.06) < 0.003, `${k} x=${r.x}`);
  }
  // 厚い＝高く上がりにくい
  const peak = k => { const w = L.flipWindow(SIZES[k], OPT); return L.simulateFlight(SIZES[k], OPT, { speed: w.center.speed, angle: w.center.angle }).peak; };
  assert.ok(peak('L') > peak('S'));
});

test('物理：速すぎ→回りすぎ、遅すぎ→回り足りない、浅い角度→前へ飛びすぎ', () => {
  const s = SIZES.M, w = L.flipWindow(s, OPT), c = w.center;
  const fast = L.simulateFlight(s, OPT, { speed: c.speed + w.width.speed * 2, angle: c.angle });
  const slow = L.simulateFlight(s, OPT, { speed: c.speed - w.width.speed * 2, angle: c.angle });
  const flat = L.simulateFlight(s, OPT, { speed: c.speed, angle: c.angle - w.width.angle * 2 });
  assert.ok(Math.abs(fast.rot) > Math.PI + 0.3 && fast.peak > slow.peak);
  assert.ok(Math.abs(slow.rot) < Math.PI - 0.3);
  assert.ok(flat.x > 0.06 + 0.05);
});

test('粒子：重力で落ち、鉄板上で跳ねて止まる／範囲外は床まで落ちる', () => {
  const world = { griddle: { hx: 0.3, hz: 0.2, y: 0 }, counter: { hx: 0.6, hz: 0.35, y: -0.06 }, floorY: -0.8 };
  const mk = (x, vx) => ({ x, y: 0.2, z: 0, vx, vy: 1, vz: 0, rx: 0, rz: 0, wx: 3, wz: 2, r: 0.004, rest: 0.3 });
  const a = mk(0, 0.1), b = mk(0, 3.0);
  let minVy = 0;
  for (let i = 0; i < 2400; i++) { L.stepParticle(a, 1 / 240, world); L.stepParticle(b, 1 / 240, world); minVy = Math.min(minVy, a.vy); }
  assert.ok(minVy < -1, '重力で加速する');
  assert.ok(a.sleep && Math.abs(a.y - 0.004) < 1e-9 && a.hits >= 1);
  assert.ok(b.sleep && b.restFloor === -0.8);
});

test('焼き色：焼き加減が進むほど暗くなる', () => {
  let prev = Infinity;
  for (let d = 0; d <= 1.0001; d += 0.05) {
    const c = L.donenessColor(d), lum = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    assert.ok(lum < prev); prev = lum;
  }
});

test('焼き色：こんがりは薄く、濃い茶色は焼きすぎ以降', () => {
  const lum = d => { const c = L.donenessColor(d); return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; };
  assert.ok(lum(OPT) > 0.55, 'こんがり（最適）は明るい');
  assert.ok(lum(0.90) < 0.38, '焼きすぎは濃い茶色');
});

test('焼き加減の減点：100% から 5% 離れるごとに 3 点（焼かなさすぎも焼きすぎも）', () => {
  const atPct = p => p / 100 * OPT; // 表示が p% になる焼き加減
  assert.equal(L.donenessPenalty(OPT), 0);
  assert.equal(L.donenessPenalty(atPct(96)), 0); assert.equal(L.donenessPenalty(atPct(104)), 0);
  assert.equal(L.donenessPenalty(atPct(95)), 3); assert.equal(L.donenessPenalty(atPct(105)), 3);
  assert.equal(L.donenessPenalty(atPct(90)), 6); assert.equal(L.donenessPenalty(atPct(89)), 6);
  assert.equal(L.donenessPenalty(atPct(50)), 30);  // 生焼け
  assert.equal(L.donenessPenalty(0.93), 21);       // 焦げの入り口（137%）
  assert.equal(L.donenessPenalty(1), 27);          // いちばん焼いた（147%）
  // 表示の％と同じ丸めで判定する：表示が同じなら減点も同じ
  for (let d = 0.3; d <= 1; d += 0.0007) { const p = L.donenessPercent(d); assert.equal(L.donenessPenalty(d), Math.floor(Math.abs(p - 100) / 5) * 3); }
  const s = L.makeSize(cm3(900), cm(15));
  const perfectAt = d => { const w = L.flipWindow(s, d); const j = L.judge(s, d, { speed: w.center.speed, angle: w.center.angle }); return { j, score: L.score(s, j) }; };
  assert.equal(perfectAt(0.95).score, 100 - L.donenessPenalty(0.95)); assert.equal(perfectAt(0.95).j.burnt, true);
  assert.equal(perfectAt(OPT).j.burnt, false); assert.equal(perfectAt(OPT).score, 100);
});

test('焼き加減の表示%：最適が100%、焼きすぎは100%を超える', () => {
  assert.equal(L.donenessPercent(OPT), 100);
  assert.equal(L.donenessPercent(0), 0);
  assert.ok(L.donenessPercent(0.5) < 100);
  assert.equal(L.donenessPercent(0.82), 121); // 焼きすぎの入り口
  assert.equal(L.donenessPercent(0.93), 137); // 焦げの入り口
  assert.equal(L.donenessPercent(1), 147);
});
