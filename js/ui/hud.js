/**
 * HUD：花种列表、信息面板、环形刻度、进度、提示与状态灯。
 * 只负责 DOM，不含任何业务状态；数值变化时才写 DOM，避免每帧重排。
 */
const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const pad2 = (n) => String(n).padStart(2, '0');

/** 4 段式花期：含苞 → 初绽 → 半开 → 盛放 */
export const STAGES = [
  { max: 0.25, zh: '含苞', en: 'BUD' },
  { max: 0.5, zh: '初绽', en: 'BREAKING' },
  { max: 0.8, zh: '半开', en: 'OPENING' },
  { max: 1.01, zh: '盛放', en: 'FULL BLOOM' },
];
export function stageOf(b) {
  for (let i = 0; i < STAGES.length; i++) if (b < STAGES[i].max) return { ...STAGES[i], index: i };
  return { ...STAGES[3], index: 3 };
}

/** 一朵花完整开放的“时长”（PHASE 显示 bloom × 8.00s） */
export const PHASE_SECONDS = 8;

export class Hud {
  constructor(species, { onPick, title } = {}) {
    this.species = species;
    this.title = title || '';
    this.app = $('app');
    this.root = document.documentElement;
    this.el = {
      list: $('speciesList'), idxCur: $('idxCur'), idxTotal: $('idxTotal'), name: $('spName'), latin: $('spLatin'),
      family: $('spFamily'), color: $('spColor'), phase: $('spPhase'), pct: $('pct'), stage: $('stageLabel'),
      gauge: $('gaugeFill'), frame: $('frameNo'), bar: $('bloomBar'), barPct: $('bloomPct'),
      ringMain: $('ringMain'), ringFaint: $('ringFaint'), ringProgress: $('ringProgress'), ticks: $('ticks'),
      orbA: $('orbA'), orbB: $('orbB'), orbC: $('orbC'), pill: $('visionPill'), pillText: $('visionText'),
      clock: $('clock'), toast: $('toast'), hint: $('hint'), hands: $('handCount'),
      bloomCard: document.querySelector('.ctl-bloom'),
      bloomHow: document.querySelector('.ctl-bloom .ctl-v span'),
      switchHow: document.querySelector('.ctl-switch .ctl-v span'),
    };
    this.gaugeC = 2 * Math.PI * 52;
    this.ringC = 1;
    this.last = {};
    this.toastTimer = 0;
    this.hintTimer = 0;
    this.toastOn = false;
    this.hintOn = false;
    this.el.idxTotal.textContent = pad2(species.length);
    this.buildList(onPick);
    this.tickClock();
    setInterval(() => this.tickClock(), 1000);
  }

  buildList(onPick) {
    const frag = document.createDocumentFragment();
    this.chips = this.species.map((s, i) => {
      const b = document.createElement('button');
      b.className = 'sp';
      b.type = 'button';
      b.dataset.i = i;
      b.setAttribute('aria-label', `${s.zh} ${s.latin}`);
      b.innerHTML = `<span class="n">${pad2(i + 1)}</span><span class="z"><span class="zf">${s.zh}</span><span class="zs">${s.short || s.zh}</span></span>`;
      b.addEventListener('click', () => onPick && onPick(i));
      frag.appendChild(b);
      return b;
    });
    this.el.list.appendChild(frag);
  }

  /** 切换花种时更新文案、强调色与列表高亮 */
  setSpecies(i) {
    const s = this.species[i];
    this.root.style.setProperty('--accent', s.accent);
    this.el.idxCur.textContent = pad2(i + 1);
    this.el.name.textContent = s.zh;
    this.el.latin.textContent = s.latin;
    this.el.family.textContent = s.family;
    this.el.color.textContent = s.color;
    this.chips.forEach((c, k) => {
      c.classList.toggle('on', k === i);
      c.setAttribute('aria-current', k === i ? 'true' : 'false');
    });
    // 移动端横向列表：把当前项滚到中间
    const list = this.el.list, chip = this.chips[i];
    if (list.scrollWidth > list.clientWidth + 2) {
      const left = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2;
      list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
    if (this.title) document.title = this.title;
  }

  announce(i) {
    const s = this.species[i];
    this.toast(`SPECIES ${pad2(i + 1)} · <b>${s.zh}</b>`);
  }

  /** 根据花朵在屏幕上的位置布置刻度环 */
  layout(focus, desktop) {
    const { cx, cy, radius: r } = focus;
    const st = this.root.style;
    st.setProperty('--fx', `${cx.toFixed(1)}px`);
    st.setProperty('--fy', `${cy.toFixed(1)}px`);
    st.setProperty('--fr', `${r.toFixed(1)}px`);
    const R = r * 1.1;
    const RF = r * (desktop ? 1.34 : 1.2);
    const set = (node, attrs) => { for (const k in attrs) node.setAttribute(k, typeof attrs[k] === 'number' ? attrs[k].toFixed(2) : attrs[k]); };
    set(this.el.ringMain, { cx, cy, r: R });
    set(this.el.ringFaint, { cx, cy, r: RF });
    set(this.el.ringProgress, { cx, cy, r: R, transform: `rotate(-90 ${cx.toFixed(2)} ${cy.toFixed(2)})` });
    this.ringC = 2 * Math.PI * R;
    this.el.ringProgress.style.strokeDasharray = `${this.ringC.toFixed(2)}`;
    this.last.ring = -1;

    const ticks = this.el.ticks;
    while (ticks.firstChild) ticks.removeChild(ticks.firstChild);
    const N = 72;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const major = k % 6 === 0;
      const r0 = R + 4, r1 = R + (major ? 11 : 7);
      const line = document.createElementNS(SVGNS, 'line');
      set(line, { x1: cx + Math.cos(a) * r0, y1: cy + Math.sin(a) * r0, x2: cx + Math.cos(a) * r1, y2: cy + Math.sin(a) * r1 });
      if (major) line.setAttribute('class', 'major');
      ticks.appendChild(line);
    }
    for (const g of document.querySelectorAll('#haloG .orbit')) g.style.transformOrigin = `${cx.toFixed(1)}px ${cy.toFixed(1)}px`;
    set(this.el.orbA, { cx: cx + R, cy });
    set(this.el.orbB, { cx, cy: cy - RF });
    set(this.el.orbC, { cx: cx - R * Math.cos(0.6), cy: cy + R * Math.sin(0.6) });
  }

  /** 每帧调用：仅在显示值变化时写 DOM */
  setBloom(b) {
    const L = this.last;
    const pct = Math.round(b * 100);
    if (pct !== L.pct) {
      L.pct = pct;
      this.el.pct.textContent = pct;
      this.el.barPct.textContent = `${pct}%`;
      this.el.bar.style.width = `${pct}%`;
      this.el.bloomCard?.setAttribute('aria-valuenow', String(pct));
      const st = stageOf(b);
      if (st.index !== L.stage) {
        L.stage = st.index;
        this.el.stage.textContent = st.zh;
        this.el.frame.textContent = pad2(st.index + 1);
      }
    }
    const g = Math.round(b * 400);
    if (g !== L.gauge) {
      L.gauge = g;
      this.el.gauge.style.strokeDashoffset = (this.gaugeC * (1 - b)).toFixed(2);
    }
    const ring = Math.round(b * 600);
    if (ring !== L.ring) {
      L.ring = ring;
      this.el.ringProgress.style.strokeDashoffset = (this.ringC * (1 - b)).toFixed(2);
    }
    const ph = (b * PHASE_SECONDS).toFixed(2);
    if (ph !== L.phase) { L.phase = ph; this.el.phase.textContent = `${ph}s`; }
  }

  /** 顶部状态灯：loading / online / demo / touch / error */
  setPill(state, text) {
    if (this.last.pillState !== state) { this.last.pillState = state; this.el.pill.dataset.state = state; }
    if (this.last.pillText !== text) { this.last.pillText = text; this.el.pillText.textContent = text; }
  }

  setHands(n) {
    if (n === this.last.hands) return;
    this.last.hands = n;
    this.el.hands.textContent = `${n} HAND${n === 1 ? '' : 'S'}`;
  }

  /** 控制卡片上的操作说明随模式变化 */
  setHowTo(bloom, swipe) {
    if (this.el.bloomHow && this.el.bloomHow.textContent !== bloom) this.el.bloomHow.textContent = bloom;
    if (this.el.switchHow && this.el.switchHow.textContent !== swipe) this.el.switchHow.textContent = swipe;
  }

  toast(html, { warn = false, ms = 1800 } = {}) {
    const t = this.el.toast;
    t.innerHTML = html;
    t.classList.toggle('warn', warn);
    t.classList.add('show');
    this.toastOn = true;
    this.syncMsg();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.classList.remove('show'); this.toastOn = false; this.syncMsg(); }, ms);
  }

  hint(text, ms = 3600) {
    const h = this.el.hint;
    clearTimeout(this.hintTimer);
    if (!text) { h.classList.remove('show'); this.hintOn = false; this.syncMsg(); return; }
    h.textContent = text;
    h.classList.add('show');
    this.hintOn = true;
    this.syncMsg();
    if (ms > 0) this.hintTimer = setTimeout(() => { h.classList.remove('show'); this.hintOn = false; this.syncMsg(); }, ms);
  }

  /** 移动端提示与 FRAME 标签共用一个位置：有提示时隐藏 FRAME 标签；吐司优先 */
  syncMsg() {
    this.app.classList.toggle('msg', this.toastOn || this.hintOn);
    this.el.hint.classList.toggle('muted', this.toastOn);
  }

  tickClock() {
    const d = new Date();
    this.el.clock.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
}
