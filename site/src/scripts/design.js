// Interactions for the design system’s static documentation.
import { motion } from './site.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ── Extruded mark ───────────────────────────────────────────
const MARK = `<g fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round"><path d="M32 55V45"/><path d="M32 45C25 42 12 38 11 24C10.5 17 12 12 15.5 7.5"/><path d="M32 45C39 42 52 38 53 24C53.5 17 52 12 48.5 7.5"/><path d="M11.6 31C18 29.5 23 26 24.5 19.5"/><path d="M52.4 31C46 29.5 41 26 39.5 19.5"/></g><g fill="currentColor"><circle cx="15.5" cy="7.5" r="4.4"/><circle cx="48.5" cy="7.5" r="4.4"/><circle cx="24.6" cy="19" r="4.4"/><circle cx="39.4" cy="19" r="4.4"/><circle cx="32" cy="55.5" r="5.4"/></g>`;
const fig = $('[data-mark3d]');
const stage = $('[data-stage]');
if (stage) {
  const LAYERS = 30;
  const back = [0x1d, 0x30, 0x0c], front = [0xc5, 0xf5, 0x6a];
  stage.innerHTML = Array.from({ length: LAYERS }, (_, i) => {
    const t = i / (LAYERS - 1);
    const c = i === LAYERS - 1 ? front : back.map((b, k) => Math.round(b + (front[k] * 0.78 - b) * Math.pow(t, 1.3)));
    return `<svg viewBox="0 0 64 64" class="mark3d__layer${i === LAYERS - 1 ? ' is-front' : ''}" style="--z:${(i - LAYERS / 2) * 2.1}px;color:rgb(${c.join(' ')})">${MARK}</svg>`;
  }).join('');

  const s = { ry: -32, rx: 12, vy: 0, drag: null, t: 0, px: 0, py: 0 };
  let raf = 0, last = 0, visible = false;
  function draw() {
    const rx = s.rx - s.py * 10;
    stage.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${(s.ry + s.px * 14).toFixed(2)}deg)`;
  }
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    s.t += dt;
    if (!s.drag) {
      s.ry += s.vy * dt;
      s.vy *= Math.exp(-dt * 2.2);
      if (Math.abs(s.vy) < 6) s.ry += Math.cos(s.t * 0.6) * 9 * dt;
    }
    draw();
  };
  function syncMotion() {
    cancelAnimationFrame(raf);
    if (motion.paused) { s.vy = 0; s.px = 0; s.py = 0; }
    draw();
    last = 0;
    if (visible && !motion.paused) raf = requestAnimationFrame(tick);
  }
  $('[data-turn]').addEventListener('click', () => { s.ry += 30; s.vy = 0; draw(); });
  motion.subscribe(syncMotion);
  fig.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    s.drag = { x: e.clientX, ry: s.ry, t: performance.now(), lastX: e.clientX };
    fig.setPointerCapture(e.pointerId);
    fig.classList.add('is-dragging');
  });
  fig.addEventListener('pointermove', (e) => {
    const r = fig.getBoundingClientRect();
    if (motion.paused && !s.drag) return;
    s.px = ((e.clientX - r.left) / r.width - 0.5) * (s.drag ? 0 : 1);
    s.py = (e.clientY - r.top) / r.height - 0.5;
    if (!s.drag) return;
    const now = performance.now();
    s.vy = ((e.clientX - s.drag.lastX) / Math.max(1, now - s.drag.t)) * 1000 * 0.5;
    s.drag.t = now;
    s.drag.lastX = e.clientX;
    s.ry = s.drag.ry + (e.clientX - s.drag.x) * 0.5;
    draw();
  });
  const end = () => { s.drag = null; fig.classList.remove('is-dragging'); };
  fig.addEventListener('pointerup', end);
  fig.addEventListener('pointercancel', end);
  fig.addEventListener('pointerleave', () => { if (!s.drag) { s.px = 0; s.py = 0; } });
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    syncMotion();
  }).observe(fig);
}

// ── Theme preview ───────────────────────────────────────────
const preview = $('[data-preview]');
$$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
  const light = b.dataset.themeSet === 'light';
  if (light) preview.dataset.theme = 'light'; else delete preview.dataset.theme;
  $$('[data-theme-set]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));

// ── Table of contents ───────────────────────────────────────
const links = new Map($$('.ds-toc a').map((a) => [a.getAttribute('href').slice(1), a]));
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    links.forEach((a) => a.removeAttribute('aria-current'));
    links.get(e.target.id)?.setAttribute('aria-current', 'true');
  }
}, { rootMargin: '-30% 0px -60% 0px' });
$$('.ds-sec').forEach((s) => spy.observe(s));
