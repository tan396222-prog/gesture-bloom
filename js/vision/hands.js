/**
 * 手势识别模块
 * - 前置摄像头 + MediaPipe HandLandmarker（双手、VIDEO 模式，全部在本机浏览器内运行）
 * - 依赖多源加载：本地 vendor → jsDelivr → npmmirror（国内）→ unpkg
 * - 输出：每只手的张开度 openness（0 = 握拳，1 = 五指张开）、掌心位置、角色（开花 / 切换）以及横扫事件
 */
const VER = '0.10.21';
const here = (p) => new URL(p, import.meta.url).href;

const VISION_SOURCES = [
  { name: 'local', mod: here('../../vendor/mediapipe/vision_bundle.js'), wasm: here('../../vendor/mediapipe/wasm') },
  { name: 'jsdelivr', mod: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`, wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/wasm` },
  { name: 'npmmirror', mod: `https://registry.npmmirror.com/@mediapipe/tasks-vision/${VER}/files/vision_bundle.mjs`, wasm: `https://registry.npmmirror.com/@mediapipe/tasks-vision/${VER}/files/wasm` },
  { name: 'unpkg', mod: `https://unpkg.com/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`, wasm: `https://unpkg.com/@mediapipe/tasks-vision@${VER}/wasm` },
];
const MODEL_SOURCES = [
  here('../../models/hand_landmarker.task'),
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
];

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));

async function fetchBytes(url, onProgress) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let bytes;
  if (res.body && total && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress?.(Math.min(0.99, got / total));
    }
    bytes = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  // 防止静态托管把缺失文件回退成 index.html
  if (bytes.length < 100000 || bytes[0] === 0x3c) throw new Error('invalid model file');
  onProgress?.(1);
  return bytes;
}

function angleBetween(a, b, c, d) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = d.x - c.x, vy = d.y - c.y, vz = d.z - c.z;
  const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  const cos = (ux * vx + uy * vy + uz * vz) / (lu * lv);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

/** 张开度：四指用关节弯曲角（3D 世界坐标，抗旋转），拇指用指尖到食指根部的距离 */
export function handOpenness(world, lm) {
  const P = world && world.length === 21 ? world : lm;
  const fingers = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  let sum = 0;
  for (const [m, p, d, t] of fingers) {
    const curl = angleBetween(P[0], P[m], P[m], P[p]) + angleBetween(P[m], P[p], P[p], P[d]) + angleBetween(P[p], P[d], P[d], P[t]);
    sum += clamp01(1 - (curl - 0.5) / 2.5);
  }
  const palm = dist(P[0], P[9]) || 1;
  const thumb = clamp01((dist(P[4], P[5]) / palm - 0.42) / 0.5);
  return clamp01(sum * 0.22 + thumb * 0.12);
}

export class HandTracker {
  constructor({ video, onStatus, onSwipe } = {}) {
    this.video = video;
    this.onStatus = onStatus || (() => {});
    this.onSwipe = onSwipe || (() => {});
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.hands = [];          // 当前帧的手（已平滑）
    this.bloomHand = null;
    this.switchHand = null;
    this.lastVideoTime = -1;
    this.lastDetect = 0;
    this.detectCost = 0;
    this.history = [];
    this.lastSwipe = 0;
    this.lastSeen = 0;
    this.source = '';
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async startCamera() {
    if (!window.isSecureContext) {
      const e = new Error('INSECURE');
      e.code = 'INSECURE';
      throw e;
    }
    if (!HandTracker.supported()) {
      const e = new Error('UNSUPPORTED');
      e.code = 'UNSUPPORTED';
      throw e;
    }
    const constraints = {
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (err && err.name === 'OverconstrainedError') this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      else throw err;
    }
    const v = this.video;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.muted = true;
    v.srcObject = this.stream;
    await new Promise((resolve) => {
      if (v.readyState >= 2) return resolve();
      v.onloadeddata = () => resolve();
      setTimeout(resolve, 3000);
    });
    try { await v.play(); } catch (e) { /* iOS 某些情况下需再次点击 */ }
  }

  async loadModel(onProgress) {
    this.onStatus('loading', 0);
    let modelBytes = null;
    let lastErr;
    for (const url of MODEL_SOURCES) {
      try {
        modelBytes = await fetchBytes(url, (p) => { onProgress?.(p * 0.8); this.onStatus('loading', p * 0.8); });
        break;
      } catch (e) { lastErr = e; console.warn('[hands] model source failed', url, e.message); }
    }
    if (!modelBytes) throw lastErr || new Error('model unavailable');

    for (const src of VISION_SOURCES) {
      let vision;
      try {
        vision = await import(/* @vite-ignore */ src.mod);
      } catch (e) { console.warn('[hands] vision module failed', src.name); continue; }
      try {
        const fileset = await vision.FilesetResolver.forVisionTasks(src.wasm);
        for (const delegate of ['GPU', 'CPU']) {
          try {
            this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetBuffer: modelBytes, delegate },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.55,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
            this.source = `${src.name}/${delegate}`;
            break;
          } catch (e) { console.warn('[hands] delegate failed', delegate, e && e.message); }
        }
      } catch (e) { console.warn('[hands] wasm failed', src.name, e && e.message); }
      if (this.landmarker) break;
    }
    if (!this.landmarker) throw new Error('HandLandmarker init failed');
    onProgress?.(1);
    this.running = true;
    this.onStatus('online', 1);
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.hands = [];
    this.bloomHand = this.switchHand = null;
  }

  /** 每帧调用；内部按视频帧与耗时自适应节流 */
  update(now) {
    if (!this.running || !this.landmarker) return false;
    const v = this.video;
    if (v.readyState < 2 || v.videoWidth === 0) return false;
    if (v.currentTime === this.lastVideoTime) return false;
    const minGap = this.detectCost > 22 ? 60 : 30;
    if (now - this.lastDetect < minGap) return false;
    this.lastVideoTime = v.currentTime;
    this.lastDetect = now;
    let res;
    const t0 = performance.now();
    try { res = this.landmarker.detectForVideo(v, now); } catch (e) { return false; }
    this.detectCost = this.detectCost * 0.8 + (performance.now() - t0) * 0.2;
    this.process(res, now);
    return true;
  }

  process(res, now) {
    const raw = [];
    const n = res && res.landmarks ? res.landmarks.length : 0;
    for (let i = 0; i < n; i++) {
      const lm = res.landmarks[i];
      const world = res.worldLandmarks && res.worldLandmarks[i];
      const ids = [0, 5, 9, 13, 17];
      let x = 0, y = 0;
      for (const k of ids) { x += lm[k].x; y += lm[k].y; }
      x /= ids.length; y /= ids.length;
      raw.push({ lm, x: 1 - x, y, open: handOpenness(world, lm), size: Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) });
    }
    // 与上一帧匹配，做时间平滑
    const prev = this.hands;
    const used = new Set();
    for (const h of raw) {
      let best = null, bd = 0.25;
      for (const p of prev) {
        if (used.has(p)) continue;
        const d = Math.hypot(p.x - h.x, p.y - h.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) {
        used.add(best);
        h.open = best.open + (h.open - best.open) * 0.45;
        h.frames = best.frames + 1;
        h.id = best.id;
      } else {
        h.frames = 1;
        h.id = Math.random().toString(36).slice(2, 7);
      }
    }
    raw.sort((a, b) => a.x - b.x);
    this.hands = raw;
    if (raw.length) this.lastSeen = now;
    // 角色：双手时屏幕右侧 = 开花，左侧 = 切换；单手时两者兼任
    if (raw.length >= 2) { this.switchHand = raw[0]; this.bloomHand = raw[raw.length - 1]; }
    else if (raw.length === 1) { this.switchHand = raw[0]; this.bloomHand = raw[0]; }
    else { this.switchHand = this.bloomHand = null; }
    for (const h of raw) h.role = h === this.bloomHand && h === this.switchHand ? 'both' : h === this.bloomHand ? 'bloom' : 'switch';
    this.detectSwipe(now);
  }

  detectSwipe(now) {
    const h = this.switchHand;
    if (!h || h.frames < 3) { this.history = []; return; }
    const last = this.history[this.history.length - 1];
    if (last && (last.id !== h.id || Math.abs(last.x - h.x) > 0.3)) this.history = [];
    this.history.push({ t: now, x: h.x, y: h.y, open: h.open, id: h.id });
    while (this.history.length && now - this.history[0].t > 420) this.history.shift();
    if (now - this.lastSwipe < 850 || this.history.length < 4) return;
    const first = this.history[0];
    const dx = h.x - first.x, dy = h.y - first.y;
    const minOpen = Math.min(...this.history.map((e) => e.open));
    if (minOpen > 0.5 && Math.abs(dx) > 0.2 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      this.lastSwipe = now;
      this.history = [];
      this.onSwipe(dx < 0 ? 1 : -1);
    }
  }

  /** 开花目标值（0~1）；无手时返回 null */
  bloomTarget() {
    const h = this.bloomHand;
    if (!h) return null;
    const x = clamp01((h.open - 0.14) / 0.72);
    return x * x * (3 - 2 * x);
  }

  /** 在预览画布上绘制手部骨架（与镜像后的视频对齐） */
  drawSkeleton(ctx, w, h, accent = '#d7ff3f') {
    ctx.clearRect(0, 0, w, h);
    const v = this.video;
    const vw = v.videoWidth || 640, vh = v.videoHeight || 480;
    // object-fit: cover 的映射
    const s = Math.max(w / vw, h / vh);
    const ox = (w - vw * s) / 2, oy = (h - vh * s) / 2;
    const map = (p) => [w - (p.x * vw * s + ox), p.y * vh * s + oy];
    for (const hand of this.hands) {
      const col = hand.role === 'switch' ? '#7fe7ff' : accent;
      const pts = hand.lm.map(map);
      ctx.lineCap = 'round';
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.lineWidth = Math.max(1.5, w / 160);
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); }
      ctx.stroke();
      ctx.shadowBlur = 0;
      for (let i = 0; i < pts.length; i++) {
        const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
        ctx.fillStyle = tip ? '#ffffff' : col;
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], tip ? Math.max(2.2, w / 90) : Math.max(1.5, w / 140), 0, Math.PI * 2);
        ctx.fill();
      }
      const [wx, wy] = pts[0];
      ctx.font = `600 ${Math.max(9, Math.round(w / 22))}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = col;
      const tag = hand.role === 'bloom' ? 'R · BLOOM' : hand.role === 'switch' ? 'L · SWITCH' : 'BLOOM + SWIPE';
      ctx.fillText(`${tag} ${Math.round(hand.open * 100)}%`, Math.min(wx + 6, w - 110), Math.min(wy + 14, h - 6));
    }
  }
}
