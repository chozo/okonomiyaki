/* お好み焼き、ひっくり返せ！ — 純ロジック（描画非依存）
 * ブラウザでは window.OkoLogic、Node では module.exports として使う。
 * 単位：長さ m、時間 s、速度 m/s、角度 deg（フリック）/ rad（回転）。
 */
(function (root) {
  'use strict';

  var G = 9.8;

  // 生地の形は「落とした量（体積 V）」と「広げた直径 D」から決まる：厚み h = V / (π (D/2)^2)
  // たくさん落として狭く広げれば厚く、少なく落として広く広げれば薄い。
  var DENSITY = 900;                  // kg/m^3（0.9 g/cm^3）
  var H_MIN = 0.008, H_MAX = 0.036;   // 厚みの正規化範囲（0.8cm〜3.6cm）
  var D_REF_MIN = 0.12, D_REF_MAX = 0.30;
  var POUR = {
    rateMin: 40e-6, rateMax: 300e-6,  // 落とす速さ m^3/s（長押しで傾きが増して速くなる）
    rampTime: 1.4,                    // 最大の傾きに達するまでの秒数
    vMin: 150e-6, vMax: 1200e-6,      // 焼き始められる量 / ボウルの容量
    hPuddle: 0.036                    // 落としたままの生地はこの厚みまで盛り上がる
  };
  var SPREAD = {
    hMin: 0.006,                      // これ以上薄く広げると生地が切れる
    dMax: 0.30,                       // 鉄板の幅に収まる最大直径
    perRev: 0.016                     // ふちを1周なぞると直径がこれだけ広がる（厚み 2cm 基準）
  };
  var OPT_DONENESS = 0.68;

  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function area(diameter) { return Math.PI * diameter * diameter / 4; }
  /** 厚み m = 体積 / 面積 */
  function thicknessFrom(volume, diameter) { return volume / area(diameter); }
  /** 実測の形（体積・直径）→ ロジックで使う size オブジェクト */
  function makeSize(volume, diameter) {
    return { volume: volume, diameter: diameter, thickness: thicknessFrom(volume, diameter) };
  }
  /** 落としただけの水たまりの直径（hPuddle の厚みまで盛り上がる） */
  function puddleDiameter(volume) { return 2 * Math.sqrt(volume / (Math.PI * POUR.hPuddle)); }
  /** 体積 V で取りうる直径の範囲 [落としたまま, これ以上は切れる/鉄板からはみ出す] */
  function spreadRange(volume) {
    var dMin = puddleDiameter(volume);
    var dMax = Math.min(SPREAD.dMax, 2 * Math.sqrt(volume / (Math.PI * SPREAD.hMin)));
    return { min: dMin, max: Math.max(dMin, dMax) };
  }
  /** 長押し t 秒目の落とす速さ m^3/s（最初はぽたぽた、だんだん傾いてどっと出る） */
  function pourRate(holdT) {
    var k = smoothstep(0, POUR.rampTime, holdT);
    return lerp(POUR.rateMin, POUR.rateMax, k);
  }
  /**
   * 生地を足す：体積が増え、直径は「今の直径」と「水たまりの直径」の大きい方（真ん中に盛られて厚くなる）
   * shape = { volume, diameter } を更新して返す
   */
  function pourStep(shape, dV) {
    var v = Math.min(POUR.vMax, shape.volume + Math.max(0, dV));
    var d = Math.max(shape.diameter || 0, puddleDiameter(v));
    return { volume: v, diameter: Math.min(d, spreadRange(v).max) };
  }
  /**
   * 円を描いて広げる：revs 周ぶん直径が広がる。薄いほど広がりにくい（伸びない）。
   * 体積は変わらないので、広がった分だけ厚みが減る。
   */
  function spreadStep(shape, revs) {
    var h = thicknessFrom(shape.volume, shape.diameter);
    var ease = clamp(h / 0.02, 0.3, 1.6);
    var rg = spreadRange(shape.volume);
    var d = clamp(shape.diameter + SPREAD.perRev * ease * Math.max(0, revs), rg.min, rg.max);
    return { volume: shape.volume, diameter: d, atMax: d >= rg.max - 1e-9 };
  }

  /** 厚みの正規化 0（最薄）〜1（最厚） */
  function thicknessNorm(size) { return clamp((size.thickness - H_MIN) / (H_MAX - H_MIN), 0, 1); }
  /** 直径の正規化 0（小）〜1（大） */
  function diameterNorm(size) { return clamp((size.diameter - D_REF_MIN) / (D_REF_MAX - D_REF_MIN), 0, 1); }

  /** 質量 kg（体積 × 密度） */
  function mass(size) { return DENSITY * area(size.diameter) * size.thickness; }

  /** 片面が 100% 焼けるまでの秒数（厚いほど時間がかかる） */
  function cookTime(size) { return 7 + 6 * thicknessNorm(size); }

  /** 焼き加減による窓の広さ係数：適正（~68%）で 1、生・焦げの両端で狭くなる */
  function donenessWindowFactor(d) {
    var k = (d - OPT_DONENESS) / 0.35;
    return 0.3 + 0.7 * Math.exp(-k * k);
  }

  /** 生地の強度 0〜1：厚いほど強い、焼きが浅いと弱い（焦げても弱くはならない＝硬い） */
  function strength(size, d) {
    var tn = thicknessNorm(size);
    return (0.35 + 0.65 * tn) * (0.15 + 0.85 * smoothstep(0, 0.6, d));
  }

  /**
   * 成功の窓：フリックの「速さ v (m/s)」と「角度 θ (deg, 水平=0, 真上=90)」の楕円。
   *  - 中心：厚い（重い）ほど速く・急角度が必要。焦げは硬く跳ねるので少しやさしく。
   *  - 幅  ：薄いほど広い（軽くて返しやすい）、焼き加減が両端だと狭い。
   *          直径が大きいほどヘラからはみ出してバランスを取りにくく、角度の幅が少し狭い。
   *  - collapseAt：窓からの外れ e がこの値を超えると空中崩壊。強度が低いほど 1 に近い。
   */
  function flipWindow(size, d) {
    var tn = thicknessNorm(size), dn = diameterNorm(size);
    var fd = donenessWindowFactor(d);
    var burnt = smoothstep(0.85, 1.0, d);
    var s = strength(size, d);
    return {
      center: { speed: 2.4 + 1.2 * tn - 0.3 * burnt, angle: 62 + 8 * tn },
      width: { speed: 0.9 * (1 - 0.55 * tn) * fd, angle: 16 * (1 - 0.5 * tn) * (1 - 0.2 * dn) * fd },
      strength: s,
      collapseAt: 1 + 3 * Math.pow(s, 1.5)
    };
  }

  /** フリックの窓からの距離（楕円正規化）。e<=1 が窓の内側。 */
  function flickError(win, flick) {
    var ev = (flick.speed - win.center.speed) / win.width.speed;
    var ea = (flick.angle - win.center.angle) / win.width.angle;
    return { e: Math.sqrt(ev * ev + ea * ea), ev: ev, ea: ea };
  }

  /**
   * 採点は 100 点満点からの減点方式（仕上げは採点しない）。各減点は整数に丸めてから引くので、画面の内訳の合計と点数が一致する。
   *  - 返しのずれ：成功（折れずに返せた）は窓の中心からのずれで 0〜15、惜しい（端が折れた）は 40〜70、大失敗は 0 点
   *  - 焼き加減  ：表示の％（最適=100%、整数に丸めた値）が 100% から 5% 離れるごとに 3（焼かなさすぎ・焼きすぎの両方向。96〜104% は 0）
   *  - 薄さ      ：厚み 3.0cm 以上で 0、0.8cm 以下で 30（その間は連続）。厚く小さく焼くほど返しにくいが満点に近づく
   */
  var PENALTY = { successMax: 15, nearMin: 40, nearMax: 70,
    thinMax: 30, thinFree: 0.030, thinWorst: 0.008,   // 厚み（m）：thinFree 以上は減点なし、thinWorst 以下で最大
    donenessStep: 5, donenessPerStep: 3 };            // 焼き加減：5% ごとに 3 点

  /** 3段階判定 + 返しのずれの減点 flickPenalty */
  function judge(size, d, flick) {
    var win = flipWindow(size, d);
    var fe = flickError(win, flick);
    var tier, flickPenalty;
    if (fe.e <= 1) {
      tier = 'success';
      flickPenalty = Math.round(PENALTY.successMax * fe.e);
    } else if (fe.e <= win.collapseAt) {
      tier = 'near';
      flickPenalty = Math.round(PENALTY.nearMin + (PENALTY.nearMax - PENALTY.nearMin) * (fe.e - 1) / (win.collapseAt - 1));
    } else {
      tier = 'collapse';
      flickPenalty = 100;
    }
    return { tier: tier, flickPenalty: flickPenalty, d: d, e: fe.e, ev: fe.ev, ea: fe.ea, window: win, burnt: d >= 0.93 };
  }

  /** 焼き加減の減点：表示と同じ丸めの％で、100% から 5% 離れるごとに 3 点 */
  function donenessPenalty(d) { return Math.floor(Math.abs(donenessPercent(d) - 100) / PENALTY.donenessStep) * PENALTY.donenessPerStep; }
  /** 薄さの減点：厚み 3.0cm 以上 0 〜 0.8cm 以下 30（実測の厚みで連続的に決まる） */
  function thinPenalty(size) { return Math.round(PENALTY.thinMax * clamp((PENALTY.thinFree - size.thickness) / (PENALTY.thinFree - PENALTY.thinWorst), 0, 1)); }
  /** この厚さで取れる最高点（返しも焼き加減も完璧なとき） */
  function maxScore(size) { return 100 - thinPenalty(size); }

  /** 点数の内訳：{ flick, doneness, thin, total }。大失敗は 0 点 */
  function scoreBreakdown(size, judgement) {
    var b = { flick: judgement.flickPenalty, doneness: donenessPenalty(judgement.d), thin: thinPenalty(size) };
    b.total = judgement.tier === 'collapse' ? 0 : Math.max(0, 100 - b.flick - b.doneness - b.thin);
    return b;
  }
  function score(size, judgement) { return scoreBreakdown(size, judgement).total; }

  /**
   * スワイプ → フリック。
   * dx,dy: 画面px（dy は下向き正）、dtMs: ms、viewH: ゲーム画面の高さpx。
   * 速さは「画面高さ/秒」に正規化してから m/s（ヘラ先端速度）に換算する。
   */
  var SPEED_PER_SCREEN = 0.75;
  function flickFromSwipe(dx, dy, dtMs, viewH) {
    var dist = Math.sqrt(dx * dx + dy * dy);
    var dt = Math.max(dtMs, 8);
    var screensPerSec = dist / dt * 1000 / viewH;
    var speed = Math.min(screensPerSec * SPEED_PER_SCREEN, 12);
    var angle = Math.atan2(-dy, Math.abs(dx)) * 180 / Math.PI;
    return { speed: speed, angle: angle };
  }
  /** 逆変換（テスト・自動操作用）：フリック → スワイプ px */
  function swipeForFlick(flick, dtMs, viewH) {
    var dist = flick.speed / SPEED_PER_SCREEN * viewH * dtMs / 1000;
    var a = flick.angle * Math.PI / 180;
    return { dx: dist * Math.cos(a), dy: -dist * Math.sin(a) };
  }

  /**
   * 初速・射出角・回転を決める。窓中心のフリックで「ちょうど180°回転して元の高さに戻る」。
   * 速すぎ→高く上がり回りすぎ、遅すぎ→低く回り足りない、角度が浅い→前に飛びすぎ。
   * 厚いほど上がる高さが低い（重い）。
   */
  var LAND_DX = 0.06; // 窓中心で前方に進む距離
  function launchParams(size, d, flick) {
    var tn = thicknessNorm(size);
    var j = judge(size, d, flick);
    var ev = clamp(j.ev, -6, 6), ea = clamp(j.ea, -6, 6);
    var apex = (0.34 - 0.14 * tn) * clamp(1 + 0.22 * ev, 0.25, 2.4) * clamp(1 + 0.05 * ea, 0.6, 1.4);
    var vy = Math.sqrt(2 * G * apex);
    var T = 2 * vy / G;
    var rotTarget = Math.PI * clamp(1 + 0.13 * ev, 0.15, 2.0);
    var landDx = LAND_DX - 0.05 * ea + 0.015 * ev;
    return {
      vx: landDx / T, vy: vy, omega: -rotTarget / T, // 右へ進みながら時計回り（-Z回転）
      T: T, apex: apex, rotTarget: rotTarget, landDx: landDx,
      tBreak: T * 0.42, judgement: j
    };
  }

  /** 円盤の1ステップ（放物線＋回転）。landed は下降中に元の高さへ戻った瞬間。 */
  function stepDisc(s, dt) {
    // 一様重力下の厳密な放物線積分（刻み幅に依存しない）
    s.x += s.vx * dt;
    s.y += s.vy * dt - 0.5 * G * dt * dt;
    s.vy -= G * dt;
    s.rot += s.omega * dt;
    s.t += dt;
    s.landed = s.vy < 0 && s.y <= s.y0;
    if (s.landed) {
      // 着地の瞬間まで巻き戻す（フレーム刻みによる行き過ぎを補正）
      var over = (s.y0 - s.y) / Math.max(-s.vy, 1e-6);
      over = Math.min(over, dt);
      s.x -= s.vx * over; s.rot -= s.omega * over; s.t -= over;
      s.y = s.y0;
    }
    return s;
  }
  function makeDiscState(x0, y0, lp) {
    return { x: x0, y: y0, y0: y0, vx: lp.vx, vy: lp.vy, rot: 0, omega: lp.omega, t: 0, landed: false };
  }
  /** 飛行を最後までシミュレーション（テスト用） */
  function simulateFlight(size, d, flick, dt) {
    dt = dt || 1 / 240;
    var lp = launchParams(size, d, flick);
    var s = makeDiscState(0, size.thickness / 2, lp);
    var peak = s.y;
    for (var i = 0; i < 100000 && !s.landed; i++) { stepDisc(s, dt); peak = Math.max(peak, s.y); }
    return { t: s.t, x: s.x, rot: s.rot, peak: peak, lp: lp };
  }

  /**
   * ぶちまけ粒子の1ステップ。world = { griddle:{hx,hz,y}, counter:{hx,hz,y}, floorY }
   * 鉄板・カウンターの上で跳ね、摩擦で止まる。範囲外は床まで落ちる。
   */
  function stepParticle(p, dt, world) {
    if (p.sleep) return p;
    p.vy -= G * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.rx += p.wx * dt; p.rz += p.wz * dt;
    var floor = world.floorY;
    if (Math.abs(p.x) < world.griddle.hx && Math.abs(p.z) < world.griddle.hz) floor = world.griddle.y;
    else if (Math.abs(p.x) < world.counter.hx && Math.abs(p.z) < world.counter.hz) floor = world.counter.y;
    var bottom = floor + p.r;
    if (p.y < bottom && p.vy < 0) {
      p.y = bottom;
      p.vy = -p.vy * p.rest;
      p.vx *= 0.55; p.vz *= 0.55; p.wx *= 0.5; p.wz *= 0.5;
      p.hits = (p.hits || 0) + 1;
      if (Math.abs(p.vy) < 0.12) { p.vy = 0; p.vx = 0; p.vz = 0; p.sleep = true; p.restFloor = floor; }
    }
    return p;
  }

  /** 焼き色（片面の焼き加減 0〜1 → sRGB 0〜1） */
  var COLOR_STOPS = [
    [0.00, [0.96, 0.89, 0.66]], // 生：クリーム色
    [0.40, [0.92, 0.74, 0.42]], // うっすら
    [0.72, [0.83, 0.59, 0.29]], // こんがり：薄い黄金色
    [0.88, [0.52, 0.30, 0.12]], // 焼きすぎ：濃い茶色
    [1.00, [0.17, 0.10, 0.06]]  // 焦げ
  ];
  function donenessColor(d) {
    d = clamp(d, 0, 1);
    for (var i = 1; i < COLOR_STOPS.length; i++) {
      var a = COLOR_STOPS[i - 1], b = COLOR_STOPS[i];
      if (d <= b[0]) {
        var t = (d - a[0]) / (b[0] - a[0]);
        return [lerp(a[1][0], b[1][0], t), lerp(a[1][1], b[1][1], t), lerp(a[1][2], b[1][2], t)];
      }
    }
    return COLOR_STOPS[COLOR_STOPS.length - 1][1].slice();
  }
  function donenessLabel(d) {
    if (d < 0.35) return '生焼け';
    if (d < 0.55) return '浅め';
    if (d < 0.82) return 'こんがり';
    if (d < 0.93) return '焼きすぎ';
    return '焦げ';
  }
  // 表示用の焼き加減（%）：最適 OPT_DONENESS を 100% とする。焼きすぎると 100% を超える（0.82→121%、焦げ 0.93→137%、最大 147%）
  function donenessPercent(d) { return Math.round(d / OPT_DONENESS * 100); }

  var api = {
    G: G, OPT_DONENESS: OPT_DONENESS, PENALTY: PENALTY, H_MIN: H_MIN, H_MAX: H_MAX, POUR: POUR, SPREAD: SPREAD,
    clamp: clamp, smoothstep: smoothstep, lerp: lerp,
    area: area, thicknessFrom: thicknessFrom, makeSize: makeSize, puddleDiameter: puddleDiameter,
    spreadRange: spreadRange, pourRate: pourRate, pourStep: pourStep, spreadStep: spreadStep,
    thicknessNorm: thicknessNorm, diameterNorm: diameterNorm, mass: mass, cookTime: cookTime,
    donenessPercent: donenessPercent, donenessWindowFactor: donenessWindowFactor, strength: strength,
    flipWindow: flipWindow, flickError: flickError, judge: judge,
    donenessPenalty: donenessPenalty, thinPenalty: thinPenalty, maxScore: maxScore, scoreBreakdown: scoreBreakdown, score: score,
    flickFromSwipe: flickFromSwipe, swipeForFlick: swipeForFlick,
    launchParams: launchParams, stepDisc: stepDisc, makeDiscState: makeDiscState,
    simulateFlight: simulateFlight, stepParticle: stepParticle,
    donenessColor: donenessColor, donenessLabel: donenessLabel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OkoLogic = api;
})(typeof window !== 'undefined' ? window : this);
