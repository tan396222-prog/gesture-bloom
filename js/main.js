/**
 * Bloom after dark — 手势花园 · 入口
 *
 * 模式
 *  idle   启动层后方：花朵自动呼吸开合
 *  demo   演示：自动开合，每轮切换下一种花
 *  camera 手势：前置摄像头 + MediaPipe，五指张合控制花期，张开手掌横扫切换
 *  touch  触控 / 鼠标 / 键盘：上下滑动（滚轮、↑↓）开合，左右滑动（← →）切换，点按开 / 合
 *
 * URL 参数（可选）：?sp=tulip | 3   初始花种
 *                  ?mode=demo | touch  跳过启动层
 *                  ?still=0.8         固定花期（截图 / 海报用）
 *                  ?q=low | high      画质档位
 *                  ?finale=1          直接打开终章的信（测试 / 截图用）
 *                  ?line=1            强制显示当前花的那句话
 *
 * 礼物文案（名字、天数、八句话、信）都在 js/gift.js 里。
 */
import { Hud } from './ui/hud.js';
import { GIFT, fill, giftDays } from './gift.js';
import { Finale } from './ui/finale.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const canvas = $('flora');
const params = new URLSearchParams(location.search);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeInOut = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

const DESKTOP_MQ = matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)');
const LANDSCAPE_MQ = matchMedia('(max-height: 520px) and (orientation: landscape)');
const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent);

function fatal(msg) {
  const t = $('bootText');
  if (t) t.textContent = msg;
  $('boot')?.classList.add('error');
  app.classList.add('is-booting');
}

/* ------------------------------------------------------------ 加载引擎 */
let FloraStage, SPECIES;
try {
  ({ FloraStage } = await import('./flora/engine.js'));
  ({ SPECIES } = await import('./flora/species.js'));
} catch (err) {
  console.error(err);
  fatal('资源加载失败 · 请检查网络后刷新');
  throw err;
}

const tier = params.get('q') || (isMobile ? 'low' : 'high');
const QUALITY = tier === 'low'
  ? { petalSeg: [14, 24], stamenScale: 0.7, shadowSize: 1024 }
  : { petalSeg: [18, 30], stamenScale: 1, shadowSize: 2048 };

let stage;
try {
  stage = new FloraStage(canvas, { quality: QUALITY, particles: tier === 'low' ? 170 : 260 });
} catch (err) {
  console.error(err);
  fatal('当前浏览器无法启用 WebGL · 请使用最新版 Chrome / Safari / Edge');
  throw err;
}

/* ------------------------------------------------------------ 状态 */
const N = SPECIES.length;
const S = {
  index: -1,
  bloom: 0,
  vel: 0,
  target: 0,
  mode: 'idle',
  manual: null,        // 触控 / 键盘给出的目标值
  camOn: false,
  camBusy: false,
  demoT: 0,
  swapping: false,
  queued: null,
  pending: -1,
  lastHand: 0,
  noHandHint: false,
  prewarming: false,
  still: params.has('still') ? clamp01(parseFloat(params.get('still')) || 0) : null,
};
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
let tracker = null;

const DAYS = giftDays();
const GIFT_TITLE = fill(GIFT.title || '手势控制绽放 · {days} 天');
const hud = new Hud(SPECIES, { onPick: (i) => { takeOver(); setSpecies(i); }, title: GIFT_TITLE });

/* ------------------------------------------------------------ 礼物：文案、盛放情话、终章 */
document.title = GIFT_TITLE;
document.querySelectorAll('[data-gift="days"]').forEach((el) => { el.textContent = DAYS; });
document.querySelectorAll('[data-gift="name"]').forEach((el) => { el.textContent = GIFT.name; });
(function buildStartCopy() {
  const h = $('startLove');
  const text = fill(GIFT.headline);
  h.setAttribute('aria-label', text);
  h.textContent = '';
  const nameAt = text.lastIndexOf(GIFT.name);
  [...text].forEach((ch, i) => {
    const sp = document.createElement('span');
    sp.className = 'ch' + (nameAt >= 0 && i >= nameAt && i < nameAt + GIFT.name.length ? ' accent' : '');
    sp.style.setProperty('--i', i);
    sp.setAttribute('aria-hidden', 'true');
    sp.textContent = ch;
    h.appendChild(sp);
  });
  // 副标题里的数字用衬线斜体
  const sub = $('startSub');
  sub.textContent = '';
  fill(GIFT.subline).split(/(\d+)/).forEach((part) => {
    if (!part) return;
    if (/^\d+$/.test(part)) { const b = document.createElement('b'); b.textContent = part; sub.appendChild(b); }
    else sub.appendChild(document.createTextNode(part));
  });
})();

const loveEl = $('love');
const loveText = $('loveText');
const loveIdx = $('loveIdx');
const heartBtn = $('heartBtn');
const heartCount = $('heartCount');
const forceLine = params.get('line') === '1';
const love = { on: false, index: -1 };
const seen = new Set();
let finaleAuto = false;      // 本次是否已经自动弹出过信

function loveLineOf(i) {
  const sp = SPECIES[i];
  return fill(GIFT.lines[sp.id] || Object.values(GIFT.lines)[i] || '');
}
function setLove(on) {
  if (on && love.index !== S.index) {
    love.index = S.index;
    // 按标点分段，只在标点后换行，避免把词语拆开
    loveText.textContent = '';
    (loveLineOf(S.index).match(/[^，。：；！？、,.!?]+[，。：；！？、,.!?]*/g) || []).forEach((seg) => {
      const sp = document.createElement('span');
      sp.textContent = seg;
      loveText.appendChild(sp);
    });
    loveIdx.textContent = `${String(S.index + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
  }
  if (on === love.on) return;
  love.on = on;
  loveEl.classList.toggle('show', on);
  app.classList.toggle('love-on', on);
}
function updateHeart(pop) {
  heartCount.textContent = `${seen.size}/${N}`;
  heartBtn.classList.toggle('done', seen.size >= N);
  if (pop) { heartBtn.classList.remove('pop'); void heartBtn.offsetWidth; heartBtn.classList.add('pop'); }
}
function markSeen(i) {
  if (seen.has(i)) return;
  seen.add(i);
  updateHeart(true);
  if (seen.size >= N && GIFT.autoFinale && !finaleAuto) {
    finaleAuto = true;
    // 让最后一句话先停留一会儿，再打开信
    setTimeout(() => { if (startEl.classList.contains('hide')) finale.open(); }, 3800);
  }
}
/** 每帧：盛放（≥95%）时浮现情话，合上（<88%）或换花时隐藏 */
function updateLove() {
  if (S.index < 0) return;
  const stable = !S.swapping && S.queued === null;
  if (forceLine) { setLove(true); return; }
  const started = startEl.classList.contains('hide');
  if (stable && started && S.bloom >= 0.95) {
    markSeen(S.index);
    setLove(true);
  } else if (!stable || S.bloom < 0.88 || !started) {
    setLove(false);
  }
}
const finale = new Finale({
  onOpen: () => app.classList.add('finale-on'),
  onClose: () => app.classList.remove('finale-on'),
});
heartBtn.addEventListener('click', (e) => { e.stopPropagation(); hideStart(); finale.open(); });
updateHeart(false);

/* ------------------------------------------------------------ 构图：花朵在屏幕上的位置与大小 */
function computeFocus(w, h) {
  if (DESKTOP_MQ.matches) {
    const r = Math.min(w * 0.195, h * 0.3);
    return { cx: w * 0.5, cy: h * 0.535, radius: r };
  }
  if (LANDSCAPE_MQ.matches) {
    const r = Math.min(h * 0.34, w * 0.2);
    return { cx: w * 0.45, cy: h * 0.52, radius: r };
  }
  // 竖屏手机：标题下沿与信息栏上沿之间居中
  const top = app.getBoundingClientRect().top;
  const heroB = document.querySelector('.hero').getBoundingClientRect().bottom - top;
  const infoT = $('info').getBoundingClientRect().top - top;
  const A = heroB - 6, B = infoT - 24;
  let r = Math.min(w * 0.43, (B - A) / (2 * 1.12));
  r = Math.max(r, Math.min(w * 0.3, 110));
  return { cx: w / 2, cy: (A + B) / 2, radius: r };
}

const sk = $('skeleton');
const skCtx = sk.getContext('2d');
let skW = 0, skH = 0;
function resizeSkeleton() {
  const w = sk.clientWidth, h = sk.clientHeight;
  if (!w || !h) return;
  const d = Math.min(window.devicePixelRatio || 1, 2);
  sk.width = Math.round(w * d);
  sk.height = Math.round(h * d);
  skCtx.setTransform(d, 0, 0, d, 0, 0);
  skW = w; skH = h;
}

function layout() {
  const w = app.clientWidth, h = app.clientHeight;
  if (!w || !h) return;
  const focus = computeFocus(w, h);
  hud.layout(focus, DESKTOP_MQ.matches);
  stage.resize(w, h, focus, pixelRatio);
  resizeSkeleton();
}
let layoutQueued = false;
const queueLayout = () => {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => { layoutQueued = false; layout(); });
};
new ResizeObserver(queueLayout).observe(app);
window.addEventListener('orientationchange', () => setTimeout(layout, 300));
document.fonts?.ready?.then(queueLayout);

/* ------------------------------------------------------------ 花种切换 */
function setSpecies(i, { announce = true, instant = false } = {}) {
  i = ((i % N) + N) % N;
  if (S.swapping) {
    // 切换动画进行中：记住最新请求，UI 立即响应
    S.queued = i === S.pending ? null : { i };
    hud.setSpecies(i);
    if (announce) hud.announce(i);
    return;
  }
  if (i === S.index) return;
  hud.setSpecies(i);
  if (announce) hud.announce(i);
  if (instant) { S.index = i; stage.setFlower(SPECIES[i]); return; }
  S.swapping = true;
  S.pending = i;
  canvas.classList.add('swap-out');
  setTimeout(() => {
    S.index = i;
    stage.setFlower(SPECIES[i]);
    // 新花从更闭合的状态开始，再弹性开到目标值
    S.bloom = Math.max(0, S.bloom - 0.35);
    S.vel = 0;
    stage.setBloom(S.bloom);
    requestAnimationFrame(() => {
      canvas.classList.remove('swap-out');
      S.swapping = false;
      const q = S.queued;
      S.queued = null;
      if (q) setSpecies(q.i, { announce: false });
    });
  }, 230);
}
const switchBy = (d) => setSpecies((S.queued ? S.queued.i : S.swapping ? S.pending : S.index) + d);

/** 空闲时预构建其余花种（先相邻，再其余），切换不卡顿 */
function prewarmAll() {
  const order = [];
  for (let k = 1; order.length < N - 1; k++) {
    for (const j of [S.index + k, S.index - k]) {
      const m = ((j % N) + N) % N;
      if (m !== S.index && !order.includes(m)) order.push(m);
    }
  }
  const run = () => {
    S.prewarming = true;
    stage.prewarm(order.map((m) => SPECIES[m])).finally(() => { S.prewarming = false; });
  };
  (window.requestIdleCallback || ((cb) => setTimeout(cb, 300)))(run, { timeout: 2500 });
}

/* ------------------------------------------------------------ 模式 */
const demoBtn = $('demoBtn');
const camBtn = $('camBtn');
const startEl = $('start');

function setMode(m) {
  S.mode = m;
  app.dataset.mode = m;
  demoBtn.setAttribute('aria-pressed', String(m === 'demo'));
  if (m === 'demo') {
    S.demoT = 4.4 * S.bloom;
    hud.setPill('demo', 'DEMO MODE');
    hud.setHowTo('自动演示中 · 点按接管', '每轮自动切换下一种');
  } else if (m === 'camera') {
    hud.setPill(tracker && tracker.running ? 'online' : 'loading', tracker && tracker.running ? 'VISION ONLINE' : 'VISION LOADING');
    hud.setHowTo('五指张合控制花期', '张开手掌横向滑动 ← →');
  } else if (m === 'touch') {
    S.manual = S.manual ?? S.target;
    hud.setPill('touch', 'TOUCH MODE');
    hud.setHowTo(isMobile ? '上下滑动 · 点按开合' : '滚轮 / ↑↓ / 拖动', isMobile ? '左右滑动切换' : '← → 或点击花名');
  }
}

/** 用户主动操作时退出演示 */
function takeOver() {
  if (S.mode === 'demo' || S.mode === 'idle') setMode(S.camOn ? 'camera' : 'touch');
  hideStart();
}

function hideStart() {
  if (!startEl.classList.contains('hide')) startEl.classList.add('hide');
}

/* ------------------------------------------------------------ 摄像头 / 手势 */
const video = $('video');

function camErrorMessage(err) {
  const name = err && (err.code || err.name);
  switch (name) {
    case 'INSECURE': return '摄像头需要 HTTPS 访问 · 已切换为触控模式';
    case 'UNSUPPORTED': return '当前浏览器不支持摄像头 · 已切换为触控模式';
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError': return '摄像头权限被拒绝 · 可在浏览器设置中允许后重试';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError': return '未找到可用的前置摄像头';
    case 'NotReadableError':
    case 'TrackStartError': return '摄像头被其他应用占用 · 请关闭后重试';
    default: return '手势模型加载失败 · 请检查网络后重试';
  }
}

async function enableCamera() {
  if (S.camBusy) return;
  hideStart();
  if (!window.isSecureContext) {
    hud.toast(camErrorMessage({ code: 'INSECURE' }), { warn: true, ms: 4200 });
    setMode('touch');
    return;
  }
  S.camBusy = true;
  camBtn.disabled = true;
  hud.setPill('loading', 'CAMERA…');
  let modelP = null;
  try {
    if (!tracker) {
      const { HandTracker } = await import('./vision/hands.js');
      tracker = new HandTracker({ video, onSwipe: onHandSwipe });
    }
    // 模型与摄像头授权并行加载
    modelP = tracker.landmarker ? Promise.resolve() : tracker.loadModel((p) => {
      if (!S.camOn) return;
      hud.setPill('loading', p >= 0.8 ? 'VISION INIT…' : `VISION LOADING ${Math.round((p / 0.8) * 100)}%`);
    });
    modelP.catch(() => {});
    await tracker.startCamera();
    S.camOn = true;
    app.classList.add('cam-on');
    camBtn.classList.add('on');
    camBtn.querySelector('span').textContent = '关闭摄像头';
    resizeSkeleton();
    setMode('camera');
    hud.hint('正在加载手势模型…', 0);
    await modelP;
    if (!S.camOn) return;
    tracker.running = true;
    hud.setPill('online', 'VISION ONLINE');
    hud.hint('举起手掌 · 张开五指让花绽放', 4200);
    S.lastHand = performance.now();
    S.noHandHint = false;
  } catch (err) {
    console.warn('[camera]', err);
    disableCamera();
    hud.toast(camErrorMessage(err), { warn: true, ms: 4200 });
    setTimeout(() => { if (!S.camOn && S.mode === 'touch') hud.setPill('touch', 'TOUCH MODE'); }, 2600);
    setMode('touch');
    hud.setPill('error', 'VISION ERROR');
  } finally {
    S.camBusy = false;
    camBtn.disabled = false;
  }
}

function disableCamera() {
  if (tracker) tracker.stop();
  S.camOn = false;
  app.classList.remove('cam-on');
  camBtn.classList.remove('on');
  camBtn.querySelector('span').textContent = '开启摄像头';
  skCtx.clearRect(0, 0, skW, skH);
  hud.setHands(0);
  hud.hint(null);
}

function onHandSwipe(dir) {
  if (!S.camOn) return;
  if (S.mode !== 'camera') setMode('camera');
  switchBy(dir);
}

/* ------------------------------------------------------------ 触控 / 鼠标 / 键盘 */
const drag = { id: null };
canvas.addEventListener('pointerdown', (e) => {
  if (drag.id !== null) return;
  Object.assign(drag, { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), axis: null, b0: S.manual ?? S.target, yaw0: stage.userYaw });
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.axis && Math.hypot(dx, dy) > 10) drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (drag.axis === 'y') {
    takeOver();
    S.manual = clamp01(drag.b0 - dy / (app.clientHeight * 0.42));
  } else if (drag.axis === 'x') {
    stage.userYaw = drag.yaw0 + dx * 0.005;
  }
});
const endDrag = (e) => {
  if (e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dt = performance.now() - drag.t0;
  const w = app.clientWidth;
  const flick = Math.abs(dx) > Math.max(56, w * 0.12) && dt < 1200;
  if (drag.axis === 'x' && e.type === 'pointerup' && (flick || Math.abs(dx) > w * 0.28)) {
    takeOver();
    switchBy(dx < 0 ? 1 : -1);
  } else if (!drag.axis && e.type === 'pointerup' && dt < 320) {
    takeOver();
    S.manual = (S.manual ?? S.target) > 0.5 ? 0 : 1;   // 点按：开 / 合
  }
  drag.id = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// 底部开花卡片可直接拖动（滑杆）
const bloomCard = document.querySelector('.ctl-bloom');
bloomCard.setAttribute('role', 'slider');
bloomCard.setAttribute('aria-label', '花期');
bloomCard.setAttribute('aria-valuemin', '0');
bloomCard.setAttribute('aria-valuemax', '100');
bloomCard.tabIndex = 0;
const barEl = bloomCard.querySelector('.bar');
const setFromBar = (x) => {
  const r = barEl.getBoundingClientRect();
  takeOver();
  S.manual = clamp01((x - r.left) / Math.max(1, r.width));
};
bloomCard.addEventListener('pointerdown', (e) => {
  bloomCard.setPointerCapture?.(e.pointerId);
  bloomCard.dataset.drag = e.pointerId;
  setFromBar(e.clientX);
});
bloomCard.addEventListener('pointermove', (e) => { if (bloomCard.dataset.drag === String(e.pointerId)) setFromBar(e.clientX); });
const endBar = () => { delete bloomCard.dataset.drag; };
bloomCard.addEventListener('pointerup', endBar);
bloomCard.addEventListener('pointercancel', endBar);

app.addEventListener('wheel', (e) => {
  if (!startEl.classList.contains('hide') || finale.isOpen) return;
  e.preventDefault();
  takeOver();
  S.manual = clamp01((S.manual ?? S.target) - e.deltaY * 0.0012);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const onButton = e.target && (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT');
  if (finale.isOpen) { if (e.key === 'Escape') { finale.close(); e.preventDefault(); } return; }
  if (!startEl.classList.contains('hide')) return;
  const nudge = (d) => { takeOver(); S.manual = clamp01((S.manual ?? S.target) + d); };
  switch (e.key) {
    case 'ArrowRight': takeOver(); switchBy(1); break;
    case 'ArrowLeft': takeOver(); switchBy(-1); break;
    case 'ArrowUp': nudge(0.1); break;
    case 'ArrowDown': nudge(-0.1); break;
    case ' ':
      if (onButton) return;
      takeOver(); S.manual = (S.manual ?? S.target) > 0.5 ? 0 : 1; break;
    case 'd': case 'D': demoBtn.click(); break;
    case 'c': case 'C': camBtn.click(); break;
    case 'h': case 'H': finale.open(); break;
    default:
      if (/^[1-9]$/.test(e.key) && +e.key <= N) { takeOver(); setSpecies(+e.key - 1); break; }
      return;
  }
  e.preventDefault();
});

$('prevBtn').addEventListener('click', () => { takeOver(); switchBy(-1); });
$('nextBtn').addEventListener('click', () => { takeOver(); switchBy(1); });
demoBtn.addEventListener('click', () => {
  hideStart();
  if (S.mode === 'demo') setMode(S.camOn ? 'camera' : 'touch');
  else { S.manual = null; setMode('demo'); }
});
camBtn.addEventListener('click', () => {
  if (S.camOn) { disableCamera(); setMode('touch'); }
  else enableCamera();
});
$('startCam').addEventListener('click', enableCamera);
$('startDemo').addEventListener('click', () => { hideStart(); setMode('demo'); });

if (!window.isSecureContext || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
  const fine = $('startFine');
  fine.classList.add('warn');
  fine.textContent = !window.isSecureContext
    ? '当前不是 HTTPS 页面，浏览器会禁止调用摄像头。部署到 HTTPS 域名后即可使用（本地调试请用 localhost），也可以先体验演示 / 触控模式。'
    : '当前浏览器不支持调用摄像头，可先体验演示 / 触控模式（推荐系统浏览器 Safari / Chrome）。';
}

/* ------------------------------------------------------------ 目标花期 */
const DEMO = { open: 4.4, hold: 2.0, close: 3.2, rest: 0.9 };
const DEMO_TOTAL = DEMO.open + DEMO.hold + DEMO.close + DEMO.rest;
function demoTarget(dt, autoSwitch) {
  S.demoT += dt;
  if (S.demoT >= DEMO_TOTAL) {
    S.demoT -= DEMO_TOTAL;
    if (autoSwitch) switchBy(1);
  }
  const t = S.demoT;
  if (t < DEMO.open) return easeInOut(t / DEMO.open);
  if (t < DEMO.open + DEMO.hold) return 1;
  if (t < DEMO.open + DEMO.hold + DEMO.close) return 1 - easeInOut((t - DEMO.open - DEMO.hold) / DEMO.close);
  return 0;
}

function updateTarget(now, dt) {
  if (S.mode === 'idle') { S.target = 0.08 + 0.84 * demoTarget(dt, false); return; }
  if (S.mode === 'demo') {
    S.target = demoTarget(dt, S.still === null);   // ?still 截图时不自动换花
    // 演示中出现手：自动切换为手势控制
    if (S.camOn && tracker && tracker.bloomHand && tracker.bloomHand.frames > 12) setMode('camera');
    return;
  }
  if (S.mode === 'camera') {
    const t = tracker && tracker.running ? tracker.bloomTarget() : null;
    if (t !== null) {
      S.target = t;
      S.manual = null;
      S.lastHand = now;
      if (S.noHandHint) { S.noHandHint = false; hud.hint(null); }
    } else {
      if (S.manual !== null) S.target = S.manual;      // 无手：保持当前或触控值
      if (tracker && tracker.running && !S.noHandHint && now - S.lastHand > 3500) {
        S.noHandHint = true;
        hud.hint('未检测到手 · 将手掌置于前置摄像头前', 0);
      }
    }
    return;
  }
  if (S.manual !== null) S.target = S.manual;
}

/* ------------------------------------------------------------ 自适应画质 */
const perf = { avg: 16.7, over: 0, level: 0, warm: 0 };
function perfTick(ms, dt) {
  if (S.swapping || S.prewarming || document.hidden) return;
  perf.warm += dt;
  if (perf.warm < 3) return;
  perf.avg = perf.avg * 0.94 + Math.min(ms, 120) * 0.06;
  if (perf.avg > 27) perf.over += dt; else perf.over = Math.max(0, perf.over - dt * 0.5);
  if (perf.over > 2.2 && perf.level < 4) {
    perf.level++;
    perf.over = 0;
    perf.avg = 18;
    if (perf.level === 1) pixelRatio = Math.max(1, Math.min(pixelRatio, 2) * 0.8);
    else if (perf.level === 2) stage.setShadows(false);
    else if (perf.level === 3) pixelRatio = Math.max(1, pixelRatio * 0.8);
    else pixelRatio = Math.max(0.75, pixelRatio * 0.85);
    layout();
    console.info('[perf] quality level', perf.level, 'pixelRatio', pixelRatio.toFixed(2));
  }
}

/* ------------------------------------------------------------ 主循环 */
let lastT = performance.now();
let time = 0;
let frames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const rawMs = now - lastT;
  lastT = now;
  const dt = Math.min(Math.max(rawMs / 1000, 0.001), 0.05);
  time += dt;

  if (S.camOn && tracker && tracker.running && tracker.update(now)) {
    tracker.drawSkeleton(skCtx, skW, skH, '#d7ff3f');
    hud.setHands(tracker.hands.length);
  }

  updateTarget(now, dt);
  if (S.still !== null) {
    S.bloom = S.still; S.vel = 0;
  } else {
    // 临界阻尼弹簧：跟手但不抖
    const k = S.mode === 'camera' ? 40 : 24;
    const c = 2 * Math.sqrt(k);
    S.vel += (k * (S.target - S.bloom) - c * S.vel) * dt;
    S.bloom += S.vel * dt;
    if (S.bloom < 0) { S.bloom = 0; S.vel = Math.max(0, S.vel); }
    if (S.bloom > 1) { S.bloom = 1; S.vel = Math.min(0, S.vel); }
  }
  if (drag.id === null || drag.axis !== 'x') stage.userYaw *= Math.exp(-dt * 5);

  stage.setBloom(S.bloom);
  stage.render(dt, time);
  hud.setBloom(S.bloom);
  updateLove();

  if (frames > 2) perfTick(rawMs, dt);
  if (++frames === 2) onFirstFrames();
}

function onFirstFrames() {
  app.classList.remove('is-booting');
  window.__ready = true;
  setTimeout(prewarmAll, 1500);
}

/* ------------------------------------------------------------ 页面可见性与 WebGL 上下文 */
document.addEventListener('visibilitychange', () => {
  lastT = performance.now();
  if (!document.hidden && S.camOn && video.paused) video.play().catch(() => {});
});
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[gl] context lost'); });
canvas.addEventListener('webglcontextrestored', () => { console.warn('[gl] context restored'); layout(); });

/* ------------------------------------------------------------ 启动 */
const spParam = params.get('sp');
let first = 0;
if (spParam) {
  const byId = SPECIES.findIndex((s) => s.id === spParam);
  const num = parseInt(spParam, 10);
  first = byId >= 0 ? byId : Number.isFinite(num) ? Math.min(N, Math.max(1, num)) - 1 : 0;
}
setSpecies(first, { instant: true, announce: false });
layout();
if (S.still !== null) { S.bloom = S.target = S.still; }

const modeParam = params.get('mode');
if (modeParam === 'demo' || modeParam === 'touch') { hideStart(); setMode(modeParam); }
else { S.mode = 'idle'; app.dataset.mode = 'idle'; }

if (params.get('finale') === '1') { hideStart(); finaleAuto = true; finale.open(); }

window.__bloom = { stage, hud, state: S, setSpecies, switchBy, setMode, SPECIES, finale, seen, GIFT };
requestAnimationFrame((t) => { lastT = t; loop(t); });
