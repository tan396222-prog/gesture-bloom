/**
 * 物种定义：每种花由若干组花瓣（参数化曲面）+ 雄蕊 + 花心附件 + 花茎组成。
 * phi：花瓣基部与竖直方向夹角 [花苞, 盛放]；k1/k2：沿瓣长的弯曲；cup：横向内凹；
 * wrap：花苞时贴合球面的程度；delay/span：开放时序（外层先开）。
 */
import { THREE } from '../lib/three.js';
import { TAU, GOLDEN, lerp, sphereArc } from './engine.js';

/* ------------------------------------------------------------ 工具函数 */
const _c = new THREE.Color();
/** 颜色随机微扰（每片花瓣略有差异，更自然） */
function jit(hex, rng, dh = 0.012, ds = 0.06, dl = 0.05) {
  _c.set(hex);
  _c.offsetHSL((rng() - 0.5) * 2 * dh, (rng() - 0.5) * 2 * ds, (rng() - 0.5) * 2 * dl);
  return '#' + _c.getHexString();
}
function jitColors(p, rng, k = 1) {
  const dh = (rng() - 0.5) * 0.02 * k, ds = (rng() - 0.5) * 0.12 * k, dl = (rng() - 0.5) * 0.08 * k;
  for (const key of ['base', 'mid', 'tip', 'edge']) {
    if (!p[key]) continue;
    _c.set(p[key]).offsetHSL(dh, ds, dl);
    p[key] = '#' + _c.getHexString();
  }
  return p;
}

/** 花苞贴合：花瓣在花苞状态时沿球面（球心高度 yc）包裹 */
function budFit(p, yc, extra = 0) {
  const bs = p.budScale ?? 0.75;
  const r0 = p.r0 * lerp(bs, 1, 0.4);
  const a = sphereArc(r0, p.y0 ?? 0, yc, p.L * bs, extra);
  p.phi = [a.phi0, p.phi[1]];
  p.k1 = [a.k1, p.k1[1]];
  return p;
}
/** 花苞闭合：自动求 budScale，使花瓣在花苞时恰好延伸到球顶（over 为越过顶点的弧度） */
function budPole(p, yc, over = 0.12) {
  let bs = p.budScale ?? 1;
  for (let i = 0; i < 3; i++) {
    const r0 = p.r0 * lerp(bs, 1, 0.4);
    const dy = yc - (p.y0 ?? 0);
    const rho = Math.hypot(r0, dy);
    const th0 = Math.atan2(r0, dy);
    bs = ((Math.PI - th0 + over) * rho) / p.L;
  }
  p.budScale = bs;
  return budFit(p, yc);
}
/** 盛放形态：给定基点、瓣尖位置与瓣尖方向，反解圆弧脊线（phi0、k1、L） */
function aim(r0, y0, rT, yT, phiTip) {
  const dr = rT - r0, dy = yT - y0;
  const chord = Math.hypot(dr, dy);
  const g = Math.atan2(dr, dy);
  const phi0 = 2 * g - phiTip;
  const k1 = phiTip - phi0;
  const h = k1 / 2;
  const sinc = Math.abs(h) < 1e-4 ? 1 : Math.sin(h) / h;
  return { phi0, k1, L: chord / sinc };
}

/* ------------------------------------------------------------------ 芍药 */
function peony({ rng }) {
  const sepals = [];
  const petals = [];
  const YC = 0.33;
  // 萼片：在花苞外侧托住，盛放时外翻
  for (let i = 0; i < 5; i++) {
    sepals.push(budFit(jitColors({
      az: i * TAU / 5 + 0.3, r0: 0.1, y0: -0.08, L: 0.3 + rng() * 0.06, W: 0.13, vW: 0.45, bw: 0.5, tipN: 1.8,
      phi: [0, 1.75], k1: [0, -0.3], k2: [0, 0.6], cup: [0, 3.4], wrap: [1, 0.4],
      ruffle: 0.012, rfreq: 5, delay: 0, span: 0.5, layer: 0, aoMin: 0.6, thin: 0.3, budScale: 1, jag: 0.02,
      base: '#263f17', mid: '#36561f', tip: '#4a6a2a', edge: '#6e3a2e', edgeAmt: 0.5, veinAmt: 0.12, backPale: 0.1,
      seed: rng(),
    }, rng), YC));
  }
  // 外轮护瓣：宽大、碗状、边缘轻卷
  const nG = 9;
  for (let i = 0; i < nG; i++) {
    const r0 = 0.1, y0 = -0.04;
    const a = aim(r0, y0, 1.0 + rng() * 0.1, 0.36 + rng() * 0.12, 0.95 + rng() * 0.2);
    const p = jitColors({
      az: i * TAU / nG + (rng() - 0.5) * 0.3, r0, y0,
      L: a.L, W: 0.52 + rng() * 0.06, vW: 0.6, bw: 0.16, tipN: 2.7,
      phi: [0, a.phi0], k1: [0, a.k1 - 0.25], k2: [0, 0.35 + rng() * 0.15], cup: [0, 1.7 + rng() * 0.3], wrap: [1, 0.08],
      ruffle: 0.035, rfreq: 5 + rng() * 2, crinkle: 0.025, notch: 0.03 + rng() * 0.04, jag: 0.025,
      delay: rng() * 0.04, span: 0.55, layer: 0.0, aoMin: 0.45, aoRamp: 0.5, thin: 1.0,
      shingle: 0.012, shingleKeep: 0.9,
      base: '#d9708f', mid: '#f3b2c4', tip: '#fbdbe4', edge: '#fff2f5', edgeAmt: 0.5, veinAmt: 0.045, backPale: 0.04,
      seed: rng(),
    }, rng);
    petals.push(budPole(p, YC, 0.0));
  }
  // 内层重瓣：簇拥成半球形“绣球”
  const nI = 76;
  const RD = 0.6, YD = 0.02;
  for (let i = 0; i < nI; i++) {
    const t = i / (nI - 1);
    const r0 = lerp(0.1, 0.012, t), y0 = lerp(-0.02, 0.13, t);
    const al = lerp(1.32, 0.06, Math.pow(t, 0.85)) + (rng() - 0.5) * 0.08;
    const rd = RD * (0.94 + rng() * 0.1);
    const rT = rd * Math.sin(al), yT = YD + rd * Math.cos(al) * 0.95;
    const tipDir = Math.max(al - Math.PI / 2 + lerp(0.45, 0.2, t), lerp(-0.2, -0.6, t)) + (rng() - 0.5) * 0.25;
    const a = aim(r0, y0, rT, yT, tipDir);
    const p = jitColors({
      az: i * GOLDEN + (rng() - 0.5) * 0.3,
      r0, y0, L: a.L,
      W: lerp(0.42, 0.24, t) * (0.85 + rng() * 0.3), vW: 0.72, bw: 0.12, tipN: 2.8,
      phi: [0, a.phi0], k1: [0, a.k1], k2: [0, (rng() - 0.3) * 0.4], cup: [0, lerp(2.2, 3.0, t)], wrap: [1, lerp(0.0, 0.12, t)],
      ruffle: lerp(0.05, 0.065, t), rfreq: 6 + rng() * 3, crinkle: lerp(0.03, 0.045, t), notch: 0.04 + rng() * 0.05, jag: 0.025,
      delay: lerp(0.1, 0.34, t), span: 0.6, layer: lerp(0.25, 1, t), aoMin: 0.12, aoRamp: lerp(0.7, 0.85, t), thin: 1.1, budScale: lerp(0.8, 0.62, t),
      shingle: 0.005,
      base: '#c94a72', mid: '#ee98b0', tip: '#fbd3de', edge: '#fff1f4', edgeAmt: lerp(0.45, 0.65, t), veinAmt: 0.035, backPale: 0.18,
      seed: rng(),
    }, rng, 1.2);
    p.budScale = 1;
    budPole(p, YC, lerp(-0.08, -0.5, t));
    p.budScale = Math.min(Math.max(p.budScale, 0.6), 1.25);
    petals.push(budFit(p, YC));
  }
  return {
    petalSets: [
      { petals: sepals, look: { trans: 0.25, sheen: 0.15, roughness: 0.55, veinFreq: 6, specular: 0.5 } },
      { petals, look: { trans: 0.75, transTint: '#ffc8d6', sheen: 0.32, sheenAmt: 0.4, roughness: 0.55, specular: 0.25, env: 0.35, wrap: 0.25, veinFreq: 9, veinSharp: 0.45, bump: 0.6, sat: 1.1, budTint: '#e898b8', directAO: 0.5 } },
    ],
    stem: { color: '#355f24', radius: 0.055, calyx: '#3b6328', calyxSize: [0.13, 0.09] },
  };
}

/** 设定盛放形态（瓣尖落点 + 瓣尖方向），返回花瓣自身以便链式调用 */
function bloomTo(p, rT, yT, tipDir, k2 = 0) {
  const a = aim(p.r0, p.y0 ?? 0, rT, yT, tipDir);
  p.L = a.L;
  p.phi = [p.phi?.[0] ?? 0, a.phi0 - k2 * 0.33];
  p.k1 = [p.k1?.[0] ?? 0, a.k1 - k2 * 0.33];
  p.k2 = [p.k2?.[0] ?? 0, k2];
  return p;
}
/** 扁球面上的切线方向（与竖直方向夹角） */
const domeTangent = (al, R, H) => Math.atan2(-R * Math.cos(al), H * Math.sin(al));

function sepalRing(rng, n, o) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = jitColors({
      az: i * TAU / n + (o.az0 ?? 0.3), r0: o.r0 ?? 0.09, y0: o.y0 ?? -0.07, L: (o.L ?? 0.3) * (0.9 + rng() * 0.2), W: o.W ?? 0.12,
      vW: o.vW ?? 0.42, bw: 0.5, tipN: o.tipN ?? 1.6,
      phi: [0, (o.open ?? 1.8) + (rng() - 0.5) * 0.2], k1: [0, o.k1 ?? -0.2], k2: [0, o.k2 ?? 0.6], cup: [0, o.cup ?? 3.0], wrap: [1, 0.3],
      ruffle: 0.01, rfreq: 5, delay: 0, span: o.span ?? 0.5, layer: 0, aoMin: 0.6, thin: 0.3, budScale: 1, jag: 0.015,
      base: o.base ?? '#263f17', mid: o.mid ?? '#36561f', tip: o.tip ?? '#4a6a2a', edge: o.edge ?? '#5b3a26', edgeAmt: 0.4, veinAmt: 0.1, backPale: 0.1,
      seed: rng(),
    }, rng);
    out.push(o.yc != null ? budFit(p, o.yc) : p);
  }
  return out;
}
const SEPAL_LOOK = { trans: 0.25, sheen: 0.15, roughness: 0.5, veinFreq: 6, specular: 0.5, env: 0.4 };

/* ------------------------------------------------------------ 洋牡丹 */
function ranunculus({ rng }) {
  const YC = 0.3;
  const petals = [];
  const n = 128;
  const RD = 0.95, HD = 0.52, YD = 0.0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r0 = lerp(0.1, 0.015, t), y0 = lerp(-0.02, 0.1, t);
    const u = Math.pow(t, 0.75);
    const rT = lerp(RD, 0.05, u) * (0.97 + rng() * 0.06);
    const yT = YD + 0.08 + HD * 0.73 * Math.sqrt(Math.max(0, 1 - (rT / (RD * 1.05)) ** 2));
    const tipDir = lerp(1.45, -0.55, Math.pow(t, 0.9)) + (rng() - 0.5) * 0.1;
    const green = Math.max(0, (t - 0.86) / 0.14);
    const p = {
      az: i * GOLDEN, r0, y0, W: 0,
      vW: 0.55, bw: 0.24, tipN: 2.3,
      cup: [0, lerp(2.6, 4.4, t)], wrap: [1, 0.0],
      ruffle: 0.012, rfreq: 5, crinkle: 0.008, notch: 0.0, jag: 0.012,
      delay: lerp(0.0, 0.4, t), span: 0.58, layer: lerp(0.1, 1, t), aoMin: 0.25, aoRamp: 0.8, thin: 1.25, budScale: 1,
      shingle: 0.004,
      base: green > 0 ? '#b9a85c' : '#e3874f', mid: green > 0 ? '#e9b47c' : '#f6ad7c', tip: '#fdc89d', edge: '#f2876a',
      edgeAmt: lerp(0.45, 0.8, t), veinAmt: 0.05, backPale: 0.25,
      seed: rng(),
    };
    bloomTo(p, rT, yT, tipDir, lerp(-0.1, -0.3, t));
    p.W = p.L * lerp(0.6, 0.66, t) * (0.92 + rng() * 0.16);
    jitColors(p, rng, 0.8);
    budPole(p, YC, lerp(0.0, -0.4, t));
    p.budScale = Math.min(Math.max(p.budScale, 0.3), 1.3);
    petals.push(budFit(p, YC));
  }
  const sepals = sepalRing(rng, 5, { yc: YC, r0: 0.08, y0: -0.08, L: 0.28, W: 0.12, open: 2.0 });
  return {
    petalSets: [
      { petals: sepals, look: SEPAL_LOOK },
      { petals, segU: 14, segV: 22, look: { trans: 1.1, transTint: '#ffc79a', sheen: 0.35, sheenAmt: 0.4, roughness: 0.5, specular: 0.3, env: 0.35, wrap: 0.3, veinFreq: 8, veinSharp: 0.45, bump: 0.5, sat: 1.08, budTint: '#f2a07a', directAO: 0.5 } },
    ],
    stem: { color: '#4b7232', radius: 0.045, calyx: '#4a7030', calyxSize: [0.1, 0.07] },
  };
}

/* ------------------------------------------------------------ 重瓣郁金香 */
function tulip({ rng }) {
  const petals = [];
  const rows = [
    // n, r0, y0, rT, yT, tipDir, W, delay
    [6, 0.09, 0.0, 0.98, 0.78, 1.05, 0.5, 0.0],
    [7, 0.08, 0.02, 0.82, 0.82, 0.75, 0.48, 0.06],
    [8, 0.065, 0.04, 0.62, 0.8, 0.4, 0.44, 0.12],
    [8, 0.05, 0.06, 0.42, 0.72, 0.05, 0.38, 0.18],
    [6, 0.03, 0.08, 0.22, 0.6, -0.35, 0.3, 0.24],
  ];
  let k = 0;
  rows.forEach(([n, r0, y0, rT, yT, tipDir, W, delay], ri) => {
    for (let i = 0; i < n; i++) {
      const p = {
        az: i * TAU / n + ri * 0.45 + (rng() - 0.5) * 0.15, r0, y0, W: W * (0.94 + rng() * 0.12),
        vW: 0.68, bw: 0.2, tipN: 2.6,
        phi: [lerp(0.55, 0.3, ri / 4), 0], k1: [lerp(-1.15, -1.0, ri / 4), 0], k2: [0, 0],
        cup: [3.4, lerp(1.4, 2.6, ri / 4)], wrap: [0.92, 0.0], twist: [0.15, 0.0],
        ruffle: 0.03, rfreq: 4 + rng() * 2, crinkle: 0.018, notch: 0.02, jag: 0.015,
        delay: delay + rng() * 0.04, span: 0.6, layer: ri / 4, aoMin: 0.3, aoRamp: 0.7, thin: 0.8,
        budScale: lerp(0.86, 0.78, ri / 4), shingle: 0.008, shingleKeep: 0.8,
        base: '#2a0410', mid: '#650d2a', tip: '#86183c', edge: '#a4325a', edgeAmt: 0.45, veinAmt: 0.08, backPale: -0.15, flare: 0.25,
        seed: rng(),
      };
      bloomTo(p, rT * (0.95 + rng() * 0.1), yT * (0.95 + rng() * 0.1), tipDir + (rng() - 0.5) * 0.15, 0.2);
      // 花苞：卵形（基部外倾、上部内收）
      const Lb = p.L * p.budScale;
      p.k1[0] = -(0.75 / Math.max(Lb, 0.3)) * (1 - ri * 0.05) - 0.25;
      petals.push(jitColors(p, rng, 0.8));
      k++;
    }
  });
  return {
    petalSets: [
      { petals, look: { trans: 0.6, transTint: '#ff5a7a', sheen: 0.6, sheenAmt: 0.65, sheenRoughness: 0.35, roughness: 0.38, specular: 0.55, env: 0.5, wrap: 0.25, veinFreq: 14, veinSharp: 0.45, bump: 0.5, sat: 1.05, budTint: '#d8c0c8', directAO: 0.45 } },
    ],
    stem: { color: '#5c7d4a', radius: 0.06, calyx: '#5c7d4a', calyxSize: [0.085, 0.06] },
  };
}

/* ------------------------------------------------------------ 牡丹 */
function carpels({ THREE, rng }) {
  const g = new THREE.Group();
  const sheathMat = new THREE.MeshStandardMaterial({ color: '#8a1f4e', roughness: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  const sheath = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.07, 28, 1, true), sheathMat);
  sheath.position.y = 0.05;
  g.add(sheath);
  const cm = new THREE.MeshStandardMaterial({ color: '#c9d38c', roughness: 0.75, envMapIntensity: 0.5 });
  const sm = new THREE.MeshStandardMaterial({ color: '#d81b60', roughness: 0.45, envMapIntensity: 0.5 });
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5 + rng() * 0.3;
    const d = new THREE.Vector3(Math.sin(0.22) * Math.cos(a), Math.cos(0.22), Math.sin(0.22) * Math.sin(a));
    const c = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), cm);
    c.scale.set(0.026, 0.07, 0.026);
    c.quaternion.setFromUnitVectors(up, d);
    c.position.set(Math.cos(a) * 0.03, 0.1, Math.sin(a) * 0.03);
    const st = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0055, 6, 14, Math.PI * 1.1), sm);
    st.position.copy(c.position).addScaledVector(d, 0.07);
    st.lookAt(st.position.clone().add(new THREE.Vector3(Math.cos(a + 1.57), 0, Math.sin(a + 1.57))));
    g.add(c, st);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.update = (b) => { const s = lerp(0.7, 1, b); g.scale.setScalar(s); };
  return g;
}

function treePeony({ rng }) {
  const YC = 0.32;
  const petals = [];
  const rows = [
    // n, rT, yT, tipDir, W, delay, layer
    [8, 1.16, 0.2, 1.5, 0.62, 0.0, 0.0],
    [9, 1.04, 0.33, 1.25, 0.58, 0.07, 0.25],
    [10, 0.88, 0.44, 0.95, 0.52, 0.14, 0.5],
    [8, 0.68, 0.5, 0.62, 0.42, 0.2, 0.75],
  ];
  rows.forEach(([n, rT, yT, tipDir, W, delay, layer], ri) => {
    for (let i = 0; i < n; i++) {
      const p = {
        az: i * TAU / n + ri * 0.37 + (rng() - 0.5) * 0.2, r0: lerp(0.12, 0.1, ri / 3), y0: lerp(-0.04, 0.0, ri / 3),
        W: W * (0.9 + rng() * 0.2), vW: 0.62, bw: 0.16, tipN: 2.5,
        cup: [0, lerp(1.4, 2.2, ri / 3)], wrap: [1, 0.05],
        ruffle: 0.055, rfreq: 5 + rng() * 2.5, crinkle: 0.035, notch: 0.06 + rng() * 0.06, jag: 0.05,
        delay: delay + rng() * 0.04, span: 0.6, layer, aoMin: 0.35, aoRamp: 0.55, thin: 1.1, budScale: 1,
        shingle: 0.01, shingleKeep: 0.9,
        base: '#a1123f', mid: '#f0705f', tip: '#ff9f84', edge: '#ffc7b2', edgeAmt: 0.5, veinAmt: 0.12, backPale: 0.15, flare: 0.75,
        seed: rng(),
      };
      bloomTo(p, rT * (0.94 + rng() * 0.12), yT + (rng() - 0.5) * 0.08, tipDir + (rng() - 0.5) * 0.2, 0.25 + rng() * 0.2);
      jitColors(p, rng, 0.8);
      budPole(p, YC, lerp(0.0, -0.3, ri / 3));
      p.budScale = Math.min(p.budScale, 1.25);
      petals.push(budFit(p, YC));
    }
  });
  const sepals = sepalRing(rng, 5, { yc: YC, r0: 0.1, y0: -0.08, L: 0.32, W: 0.15, open: 1.9 });
  return {
    petalSets: [
      { petals: sepals, look: SEPAL_LOOK },
      { petals, look: { trans: 0.85, transTint: '#ffb09a', sheen: 0.4, sheenAmt: 0.45, roughness: 0.5, specular: 0.3, env: 0.38, wrap: 0.28, veinFreq: 13, veinSharp: 0.35, bump: 0.7, sat: 1.06, budTint: '#e48a8a', directAO: 0.5 } },
    ],
    stamens: [{
      count: 230, r: [0.075, 0.2], y0: 0.03, len: [0.13, 0.2], tilt: [[0.05, 0.25], [0.35, 1.05]],
      thick: 0.004, anther: [0.011, 0.026, 0.011], filament: '#f1d58a', antherColor: '#f5b316', delay: 0.25, span: 0.55, budLen: 0.6, jitter: 0.3,
    }],
    extras: [carpels],
    stem: { color: '#4d5e2a', radius: 0.05, calyx: '#55682e', calyxSize: [0.12, 0.08] },
  };
}

/* ------------------------------------------------------------ 荷花 */
function lotusPod({ THREE, rng }) {
  const prof = [
    [0.0, -0.03], [0.05, -0.025], [0.09, 0.02], [0.135, 0.09], [0.175, 0.16], [0.19, 0.192], [0.186, 0.207], [0.16, 0.214], [0.1, 0.219], [0.0, 0.222],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(prof, 56);
  const holes = [[0, 0]];
  for (let i = 0; i < 6; i++) holes.push([Math.cos(i * TAU / 6) * 0.07, Math.sin(i * TAU / 6) * 0.07]);
  for (let i = 0; i < 11; i++) holes.push([Math.cos(i * TAU / 11 + 0.3) * 0.135, Math.sin(i * TAU / 11 + 0.3) * 0.135]);
  const mat = new THREE.MeshStandardMaterial({ color: '#c5cc62', roughness: 0.62, envMapIntensity: 0.5 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHoles = { value: holes.map(([x, z]) => new THREE.Vector2(x, z)) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nuniform vec2 uHoles[18];')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float top = smoothstep(0.196, 0.206, vOP.y);
        float dmin = 1.0;
        for (int i = 0; i < 18; i++) dmin = min(dmin, length(vOP.xz - uHoles[i]));
        float hole = 1.0 - smoothstep(0.016, 0.021, dmin);
        float seed = 1.0 - smoothstep(0.006, 0.012, dmin);
        vec3 topC = vec3(0.80, 0.80, 0.42);
        vec3 c = mix(diffuseColor.rgb, topC, top);
        c = mix(c, vec3(0.20, 0.24, 0.08), hole * top);
        c = mix(c, vec3(0.55, 0.62, 0.25), seed * top);
        float side = 1.0 - top;
        c *= mix(1.0, 0.82 + 0.18 * smoothstep(-0.02, 0.18, vOP.y), side);
        diffuseColor.rgb = c;`);
  };
  mat.customProgramCacheKey = () => 'lotus-pod-v1';
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  g.position.y = 0.04;
  g.userData.update = (b) => { const s = lerp(0.7, 1.12, b); g.scale.set(s, lerp(0.8, 1.25, b), s); };
  return g;
}

function lotus({ rng }) {
  const petals = [];
  const rows = [
    // n, rT, yT, tipDir, L, W, delay, cupB
    [6, 1.2, 0.42, 1.55, 1.05, 0.44, 0.0, 2.2],
    [7, 1.04, 0.68, 1.2, 1.05, 0.42, 0.08, 2.5],
    [8, 0.8, 0.78, 0.95, 1.0, 0.38, 0.16, 2.8],
  ];
  rows.forEach(([n, rT, yT, tipDir, L, W, delay, cupB], ri) => {
    for (let i = 0; i < n; i++) {
      const p = {
        az: i * TAU / n + ri * 0.42 + (rng() - 0.5) * 0.12, r0: 0.21 - ri * 0.015, y0: -0.07 + ri * 0.012,
        W: W * (0.94 + rng() * 0.12), vW: 0.46, bw: 0.3, tipN: 1.75,
        phi: [0.5 - ri * 0.08, 0], k1: [-1.25 + ri * 0.05, 0], cup: [3.2, cupB], wrap: [0.9, 0.0], twist: [0, 0],
        ruffle: 0.008, rfreq: 4, crinkle: 0.006, notch: 0.0, jag: 0.006,
        delay: delay + rng() * 0.04, span: 0.62, layer: ri / 3, aoMin: 0.55, aoRamp: 0.45, thin: 1.0, budScale: 0.82,
        shingle: 0.006, shingleKeep: 0.85,
        base: '#fff4e2', mid: '#fde6e8', tip: '#f39bb6', edge: '#ee84a6', edgeAmt: 0.3, veinAmt: 0.15, backPale: -0.12,
        seed: rng(),
      };
      bloomTo(p, rT * (0.95 + rng() * 0.1), yT * (0.95 + rng() * 0.1), tipDir + (rng() - 0.5) * 0.12, 0.05);
      p.L = Math.max(p.L, L * 0.9);
      petals.push(jitColors(p, rng, 0.6));
    }
  });
  const sepals = sepalRing(rng, 4, { r0: 0.2, y0: -0.09, L: 0.34, W: 0.16, open: 1.85, tipN: 1.7, base: '#5d7a3a', mid: '#8a9a52', tip: '#d98aa0', edge: '#e79bb0' });
  sepals.forEach((p) => { p.phi[0] = 0.45; p.k1[0] = -1.0; p.cup = [3.0, 2.4]; p.wrap = [0.9, 0.2]; });
  return {
    petalSets: [
      { petals: sepals, look: SEPAL_LOOK },
      { petals, look: { trans: 1.1, transTint: '#ffd6e2', sheen: 0.45, sheenAmt: 0.5, roughness: 0.5, specular: 0.3, env: 0.4, wrap: 0.3, veinFreq: 16, veinSharp: 0.32, bump: 0.8, sat: 1.06, budTint: '#f6b8c8', directAO: 0.45 } },
    ],
    stamens: [{
      count: 190, r: [0.13, 0.19], y0: 0.11, len: [0.15, 0.22], tilt: [[0.0, 0.12], [0.5, 1.15]],
      thick: 0.0035, anther: [0.0075, 0.042, 0.0075], filament: '#f7ecc0', antherColor: '#f3c544', delay: 0.3, span: 0.55, budLen: 0.6, jitter: 0.25,
    }],
    extras: [lotusPod],
    stem: { color: '#5d8a3a', radius: 0.055, calyx: '#6a8f40', calyxSize: [0.16, 0.06] },
  };
}

/* ------------------------------------------------------------ 玫瑰 */
function rose({ rng }) {
  const petals = [];
  const n = 42;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = {
      az: i * GOLDEN + (rng() - 0.5) * 0.1, r0: lerp(0.1, 0.02, t), y0: lerp(-0.02, 0.08, t),
      L: lerp(0.95, 0.42, Math.pow(t, 0.8)) * (0.95 + rng() * 0.1), W: lerp(0.56, 0.3, t) * (0.93 + rng() * 0.14),
      vW: 0.66, bw: 0.12, tipN: 2.6,
      phi: [lerp(0.42, 0.18, t), lerp(1.4, 0.12, Math.pow(t, 0.62)) + (rng() - 0.5) * 0.1],
      k1: [lerp(-0.95, -0.7, t), lerp(-0.25, -0.75, t)], k2: [0, lerp(0.7, -0.1, t)],
      cup: [3.2, lerp(1.0, 3.2, t)], wrap: [0.95, lerp(0.0, 0.8, t * t)], twist: [0.12, 0.0],
      ruffle: 0.012, rfreq: 4, crinkle: 0.01, notch: 0.05, jag: 0.012,
      delay: lerp(0.0, 0.5, t), span: 0.55, layer: t, aoMin: 0.25, aoRamp: 0.7, thin: 0.75,
      budScale: lerp(0.8, 0.85, t), shingle: 0.01, shingleKeep: 0.7, roll: lerp(0.22, 0.0, Math.pow(t, 0.7)),
      base: '#2c020a', mid: '#640716', tip: '#7a0b1c', edge: '#4a0410', edgeAmt: 0.4, veinAmt: 0.05, backPale: 0.12,
      seed: rng(),
    };
    petals.push(jitColors(p, rng, 0.6));
  }
  const sepals = sepalRing(rng, 5, { r0: 0.08, y0: -0.07, L: 0.48, W: 0.075, tipN: 1.3, open: 2.15, k2: 0.9, cup: 2.0 });
  sepals.forEach((p) => { p.phi[0] = 0.4; p.k1[0] = -0.7; p.wrap = [0.9, 0.1]; });
  return {
    petalSets: [
      { petals: sepals, look: SEPAL_LOOK },
      { petals, look: { trans: 0.55, transTint: '#ff3048', sheen: 1.0, sheenAmt: 1.1, sheenRoughness: 0.32, roughness: 0.7, specular: 0.18, env: 0.4, wrap: 0.22, veinFreq: 12, veinSharp: 0.4, bump: 0.5, sat: 1.0, budTint: '#c8a0a8', directAO: 0.55 } },
    ],
    stem: { color: '#355e28', radius: 0.045, calyx: '#3d6a2c', calyxSize: [0.085, 0.09] },
  };
}

/* ------------------------------------------------------------ 鸢尾 */
function iris({ rng }) {
  const falls = [], stds = [], styles = [];
  for (let i = 0; i < 3; i++) {
    const az = i * TAU / 3 + 0.2;
    falls.push(jitColors({
      az, r0: 0.05, y0: 0.1, L: 1.08, W: 0.42, vW: 0.6, bw: 0.1, tipN: 2.4,
      phi: [0.1, 0.85], k1: [-0.22, 1.7], k2: [0, 0.55], cup: [2.6, -0.6], wrap: [0.95, 0.0], twist: [1.1, 0.0],
      ruffle: 0.05, rfreq: 5 + rng(), crinkle: 0.03, notch: 0.04, jag: 0.02,
      delay: 0.0, span: 0.62, layer: 0, aoMin: 0.45, aoRamp: 0.4, thin: 1.0, budScale: 0.78,
      base: '#f4f0fb', mid: '#45397c', tip: '#332966', edge: '#514690', edgeAmt: 0.35, veinAmt: 0.7, backPale: 0.25,
      beard: 1, beardW: 0.17, beardL: 0.46,
      seed: rng(),
    }, rng, 0.5));
    const az2 = az + Math.PI / 3;
    stds.push(jitColors({
      az: az2, r0: 0.04, y0: 0.12, L: 0.98, W: 0.42, vW: 0.62, bw: 0.1, tipN: 2.5,
      phi: [0.06, 0.42], k1: [-0.2, -1.05], k2: [0, -0.35], cup: [2.8, 1.6], wrap: [0.95, 0.0], twist: [1.1, 0.25],
      ruffle: 0.06, rfreq: 5 + rng(), crinkle: 0.035, notch: 0.03, jag: 0.02,
      delay: 0.14, span: 0.6, layer: 0.3, aoMin: 0.5, aoRamp: 0.5, thin: 1.1, budScale: 0.8,
      base: '#d6cfee', mid: '#6459a6', tip: '#6c62ae', edge: '#857bc0', edgeAmt: 0.35, veinAmt: 0.25, backPale: 0.2,
      seed: rng(),
    }, rng, 0.5));
    styles.push({
      az: az + 0.02, r0: 0.03, y0: 0.18, L: 0.46, W: 0.1, vW: 0.7, bw: 0.4, tipN: 2.2,
      phi: [0.05, 1.0], k1: [-0.1, 0.55], k2: [0, 0.2], cup: [2.0, 1.8], wrap: [0.9, 0.0],
      ruffle: 0.02, rfreq: 4, notch: 0.32, jag: 0.02,
      delay: 0.22, span: 0.55, layer: 0.5, aoMin: 0.6, thin: 1.0, budScale: 0.7,
      base: '#cfc6f5', mid: '#a99cf0', tip: '#b9aef4', edge: '#d8d0fb', edgeAmt: 0.4, veinAmt: 0.15, backPale: 0.1,
      seed: rng(),
    });
  }
  return {
    petalSets: [
      { petals: falls, look: { trans: 0.9, transTint: '#9b8cff', sheen: 0.55, sheenAmt: 0.6, roughness: 0.5, specular: 0.3, env: 0.45, wrap: 0.3, veinFreq: 14, veinSharp: 0.35, bump: 0.8, sat: 0.95, budTint: '#9a90c8', beardColor: '#f5b83a', directAO: 0.4 } },
      { petals: stds, look: { trans: 1.0, transTint: '#b0a4ff', sheen: 0.45, sheenAmt: 0.5, roughness: 0.5, specular: 0.3, env: 0.45, wrap: 0.3, veinFreq: 12, veinSharp: 0.4, bump: 0.6, sat: 0.95, budTint: '#a49ad0', directAO: 0.4 } },
      { petals: styles, look: { trans: 0.9, sheen: 0.3, roughness: 0.5, veinFreq: 8, env: 0.45 } },
    ],
    stem: { color: '#4a6e3a', radius: 0.04, y0: 0.06, calyx: '#5f8045', calyxSize: [0.055, 0.12] },
  };
}

/* ------------------------------------------------------------ 山茶 */
function camellia({ rng }) {
  const YC = 0.3;
  const petals = [];
  const perRow = 8, nRows = 9;
  const RD = 1.0, HD = 0.36, YD = 0.02;
  for (let r = 0; r < nRows; r++) {
    for (let i = 0; i < perRow; i++) {
      const t = (r * perRow + i) / (perRow * nRows - 1);
      const rt = r / (nRows - 1);
      const rT = lerp(RD, 0.08, Math.pow(rt, 0.85));
      const yT = YD + 0.05 + HD * Math.sqrt(Math.max(0, 1 - (rT / (RD * 1.05)) ** 2));
      const tipDir = lerp(1.5, -0.6, Math.pow(rt, 0.9));
      const p = {
        az: (i + (r % 2) * 0.5) * TAU / perRow + r * 0.06,
        r0: lerp(0.1, 0.02, rt), y0: lerp(-0.02, 0.1, rt), W: 0,
        vW: 0.6, bw: 0.2, tipN: 2.4,
        cup: [0, lerp(1.5, 3.4, rt)], wrap: [1, 0.0],
        ruffle: 0.006, rfreq: 4, crinkle: 0.004, notch: 0.035, jag: 0.004,
        delay: lerp(0.0, 0.42, rt) + rng() * 0.02, span: 0.58, layer: rt, aoMin: 0.35, aoRamp: 0.75, thin: 1.0, budScale: 1,
        shingle: 0.005,
        base: '#e9edd6', mid: '#f7f6ef', tip: '#fffdf9', edge: '#ffffff', edgeAmt: 0.3, veinAmt: 0.025, backPale: 0.0,
        seed: rng(),
      };
      bloomTo(p, rT, yT, tipDir, lerp(-0.05, -0.2, rt));
      p.W = p.L * lerp(0.56, 0.62, rt);
      jitColors(p, rng, 0.25);
      budPole(p, YC, lerp(0.0, -0.4, rt));
      p.budScale = Math.min(Math.max(p.budScale, 0.3), 1.3);
      petals.push(budFit(p, YC));
    }
  }
  const leaves = [];
  [0.5, 2.1, 3.7, 5.2].forEach((az, i) => {
    leaves.push({
      az, r0: 0.07, y0: -0.13, L: 1.3 + rng() * 0.15, W: 0.27, vW: 0.42, bw: 0.12, tipN: 1.45,
      phi: [1.42, 1.42], k1: [0.25, 0.25], k2: [0.25, 0.25], cup: [1.4, 1.4], wrap: [0, 0], twist: [0.1, 0.1],
      ruffle: 0.004, rfreq: 3, jag: 0.0, delay: 0, span: 1, layer: 0, aoMin: 0.5, thin: 0.25, budScale: 1,
      base: '#1d3618', mid: '#21401c', tip: '#2a4c22', edge: '#33582a', edgeAmt: 0.2, veinAmt: 0.25, backPale: 0.35,
      seed: rng(),
    });
  });
  const sepals = sepalRing(rng, 6, { yc: YC, r0: 0.08, y0: -0.08, L: 0.2, W: 0.11, tipN: 2.2, open: 1.7, base: '#5b5a2c', mid: '#6d6a34', tip: '#7c6d3a', edge: '#8b6a40' });
  return {
    petalSets: [
      { petals: leaves, segU: 10, segV: 18, look: { trans: 0.3, transTint: '#9fd080', sheen: 0.0, roughness: 0.22, specular: 0.9, env: 0.9, wrap: 0.15, veinFreq: 3, veinSharp: 0.3, bump: 0.4 } },
      { petals: sepals, look: SEPAL_LOOK },
      { petals, segU: 14, segV: 22, look: { trans: 0.95, transTint: '#fff2de', sheen: 0.35, sheenAmt: 0.35, roughness: 0.45, specular: 0.3, env: 0.4, wrap: 0.3, veinFreq: 10, veinSharp: 0.5, bump: 0.5, sat: 1.0, budTint: '#f0f0e4', directAO: 0.55 } },
    ],
    stem: { color: '#3a4f26', radius: 0.05, calyx: '#4b5a2e', calyxSize: [0.11, 0.07] },
  };
}

export const SPECIES = [
  {
    id: 'peony', zh: '月影芍药', short: '芍药', latin: 'Paeonia lactiflora', family: 'PAEONIACEAE', color: 'BLUSH / PEARL',
    accent: '#ff8fb1', pollen: '#ffd9c8', seed: 21, build: peony,
    view: { elev: 0.72, targetY: [0.34, 0.26], radius: 1.22 },
    lights: { rim: ['#ffc7da', 2.6, [2.0, 2.2, -3.4]], fill: ['#b9b0e8', 0.4, [2.6, -0.8, 2.6]], exposure: 0.92 },
  },
  {
    id: 'ranunculus', zh: '杏色洋牡丹', short: '洋牡丹', latin: 'Ranunculus asiaticus', family: 'RANUNCULACEAE', color: 'APRICOT / CORAL',
    accent: '#ffad7a', pollen: '#ffd8b0', seed: 7, build: ranunculus,
    view: { elev: 0.86, targetY: [0.3, 0.26], radius: 1.08 },
    lights: { rim: ['#ffc9a8', 2.4, [2.0, 2.2, -3.4]], fill: ['#c0b0e0', 0.4, [2.6, -0.8, 2.6]], exposure: 0.95 },
  },
  {
    id: 'tulip', zh: '酒红重瓣郁金香', short: '郁金香', latin: 'Tulipa ‘Double Late’', family: 'LILIACEAE', color: 'WINE / PLUM',
    accent: '#e05a92', pollen: '#ffb3cc', seed: 33, build: tulip,
    view: { elev: 0.62, targetY: [0.4, 0.42], radius: 1.12 },
    lights: { key: ['#fff1e6', 3.4, [-2.2, 4.4, 2.8]], rim: ['#ff9ec4', 3.0, [2.0, 2.0, -3.4]], fill: ['#b0a8ff', 0.5, [2.6, -0.8, 2.6]], exposure: 1.08 },
  },
  {
    id: 'treepeony', zh: '珊瑚台牡丹', short: '牡丹', latin: 'Paeonia suffruticosa', family: 'PAEONIACEAE', color: 'CORAL / GOLD',
    accent: '#ff7b67', pollen: '#ffd27a', seed: 5, build: treePeony,
    view: { elev: 0.78, targetY: [0.32, 0.22], radius: 1.24 },
    lights: { rim: ['#ffc0a8', 2.6, [2.0, 2.2, -3.4]], fill: ['#b8b0e8', 0.4, [2.6, -0.8, 2.6]], exposure: 0.94 },
  },
  {
    id: 'lotus', zh: '晓雾粉荷', short: '荷花', latin: 'Nelumbo nucifera', family: 'NELUMBONACEAE', color: 'DAWN PINK / IVORY',
    accent: '#ff9cc0', pollen: '#fff0b8', seed: 13, build: lotus,
    view: { elev: 0.72, targetY: [0.42, 0.34], radius: 1.22 },
    lights: { rim: ['#ffd0e0', 2.8, [2.0, 2.2, -3.4]], fill: ['#b8b8f0', 0.45, [2.6, -0.8, 2.6]], exposure: 0.95 },
  },
  {
    id: 'rose', zh: '丝绒红玫瑰', short: '玫瑰', latin: 'Rosa ‘Velvet’', family: 'ROSACEAE', color: 'CRIMSON / VELVET',
    accent: '#ff4d63', pollen: '#ffb0a0', seed: 3, build: rose,
    view: { elev: 0.66, targetY: [0.36, 0.3], radius: 1.08 },
    lights: { key: ['#fff0e8', 3.2, [-2.2, 4.4, 2.8]], rim: ['#ff8a9a', 2.6, [2.0, 2.0, -3.4]], fill: ['#a8a8ff', 0.45, [2.6, -0.8, 2.6]], exposure: 0.98 },
  },
  {
    id: 'iris', zh: '夜蓝鸢尾', short: '鸢尾', latin: 'Iris germanica', family: 'IRIDACEAE', color: 'INDIGO / GOLD',
    accent: '#9c8cff', pollen: '#ffd36e', seed: 17, build: iris,
    view: { elev: 0.38, targetY: [0.5, 0.42], radius: 1.18 },
    lights: { key: ['#fff4ea', 3.2, [-2.2, 4.4, 2.8]], rim: ['#c8b8ff', 2.6, [2.0, 2.0, -3.4]], fill: ['#a0b0ff', 0.4, [2.6, -0.8, 2.6]], exposure: 0.95 },
  },
  {
    id: 'camellia', zh: '初雪山茶', short: '山茶', latin: 'Camellia japonica ‘Alba Plena’', family: 'THEACEAE', color: 'SNOW / IVORY',
    accent: '#dfe9ff', pollen: '#f4f0e0', seed: 9, build: camellia,
    view: { elev: 0.92, targetY: [0.3, 0.2], radius: 1.3 },
    lights: { key: ['#fff2e4', 2.6, [-2.2, 4.4, 2.8]], rim: ['#d8e4ff', 2.2, [2.0, 2.2, -3.4]], fill: ['#b0b8e8', 0.35, [2.6, -0.8, 2.6]], exposure: 0.82 },
  },
];
