/**
 * 终章：给她的信 + 飘落的花瓣（2D canvas，粒子数随屏幕大小调整，移动端也很轻）。
 */
import { GIFT, fill } from '../gift.js';

const $ = (id) => document.getElementById(id);
const PETAL_COLORS = ['#ff8fb1', '#ffb3c9', '#ffd1dc', '#f7a1b9', '#ffe4ea', '#e86a8f', '#fff2f5'];

class Petals {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.raf = 0;
    this.last = 0;
    this.running = false;
    this.onResize = () => this.resize();
  }

  resize() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.c.clientWidth, h = this.c.clientHeight;
    if (!w || !h) return;
    this.w = w; this.h = h;
    this.c.width = Math.round(w * d);
    this.c.height = Math.round(h * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    const target = Math.round(Math.min(70, Math.max(26, (w * h) / 16000)));
    while (this.items.length < target) this.items.push(this.spawn(true));
    this.items.length = target;
  }

  spawn(anywhere) {
    const s = 7 + Math.random() * 10;
    return {
      x: Math.random() * (this.w || 400),
      y: anywhere ? Math.random() * (this.h || 800) - (this.h || 800) * 0.3 : -20 - Math.random() * 80,
      s,
      vy: 22 + Math.random() * 34 + s * 1.2,
      sway: 12 + Math.random() * 26,
      ph: Math.random() * Math.PI * 2,
      fr: 0.5 + Math.random() * 1.1,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 1.6,
      flip: Math.random() * Math.PI * 2,
      vf: 1 + Math.random() * 2.2,
      col: PETAL_COLORS[(Math.random() * PETAL_COLORS.length) | 0],
      a: 0.55 + Math.random() * 0.4,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    window.addEventListener('resize', this.onResize);
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt, now / 1000);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.ctx.clearRect(0, 0, this.w || 0, this.h || 0);
  }

  draw(dt, t) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < this.items.length; i++) {
      let p = this.items[i];
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vf * dt;
      const x = p.x + Math.sin(t * p.fr + p.ph) * p.sway;
      if (p.y > h + 30) { p = this.items[i] = this.spawn(false); continue; }
      ctx.save();
      ctx.translate(x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(p.flip)));   // 翻转感
      ctx.globalAlpha = p.a;
      const s = p.s;
      const g = ctx.createLinearGradient(0, -s, 0, s);
      g.addColorStop(0, '#fff3f6');
      g.addColorStop(1, p.col);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, s);
      ctx.bezierCurveTo(s * 0.95, s * 0.35, s * 0.7, -s * 0.85, 0.08 * s, -s);
      ctx.quadraticCurveTo(0, -s * 0.72, -0.08 * s, -s);
      ctx.bezierCurveTo(-s * 0.7, -s * 0.85, -s * 0.95, s * 0.35, 0, s);
      ctx.fill();
      ctx.restore();
    }
  }
}

export class Finale {
  constructor({ onOpen, onClose } = {}) {
    this.el = $('finale');
    this.petals = new Petals($('petals'));
    this.isOpen = false;
    this.onOpen = onOpen;
    this.onClose = onClose;
    $('letterEyebrow').textContent = fill(GIFT.letter.eyebrow);
    $('letterTitle').textContent = fill(GIFT.letter.title);
    $('letterSign').textContent = fill(GIFT.letter.sign);
    const body = $('letterBody');
    body.textContent = '';
    GIFT.letter.paragraphs.forEach((t, i) => {
      const p = document.createElement('p');
      p.style.setProperty('--i', i);
      p.textContent = fill(t);
      body.appendChild(p);
    });
    $('finaleClose').addEventListener('click', () => this.close());
    $('finaleBack').addEventListener('click', () => this.close());
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el || e.target.id === 'petals') this.close(); });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.el.setAttribute('aria-hidden', 'false');
    this.el.querySelector('.letter').scrollTop = 0;
    this.el.classList.add('show');
    this.petals.start();
    this.onOpen && this.onOpen();
    setTimeout(() => { if (this.isOpen) $('finaleBack').focus({ preventScroll: true }); }, 400);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.setAttribute('aria-hidden', 'true');
    this.el.classList.remove('show');
    setTimeout(() => { if (!this.isOpen) this.petals.stop(); }, 950);
    this.onClose && this.onClose();
  }
}
