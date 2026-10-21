// Design system page: the extruded 3D mark, and the token documentation, which is generated from the
// live CSS variables in tokens.css so it can never drift from what the site actually uses. (The icon
// grid is rendered at build time from the sprite.)
import { motion, reveal } from './site.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = getComputedStyle(document.documentElement);
const token = (name, style = root) => style.getPropertyValue(name).trim();

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
  let raf = 0, last = 0;
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    s.t += dt;
    if (!s.drag) {
      s.ry += s.vy * dt;
      s.vy *= Math.exp(-dt * 2.2);
      if (!motion.paused && Math.abs(s.vy) < 6) s.ry += Math.cos(s.t * 0.6) * 9 * dt;
    }
    const rx = s.rx + s.py * -10;
    stage.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${(s.ry + s.px * 14).toFixed(2)}deg)`;
  };
  fig.addEventListener('pointerdown', (e) => {
    s.drag = { x: e.clientX, ry: s.ry, t: performance.now(), lastX: e.clientX };
    fig.setPointerCapture(e.pointerId);
    fig.classList.add('is-dragging');
  });
  fig.addEventListener('pointermove', (e) => {
    const r = fig.getBoundingClientRect();
    s.px = ((e.clientX - r.left) / r.width - 0.5) * (s.drag ? 0 : 1);
    s.py = (e.clientY - r.top) / r.height - 0.5;
    if (!s.drag) return;
    const now = performance.now();
    s.vy = ((e.clientX - s.drag.lastX) / Math.max(1, now - s.drag.t)) * 1000 * 0.5;
    s.drag.t = now;
    s.drag.lastX = e.clientX;
    s.ry = s.drag.ry + (e.clientX - s.drag.x) * 0.5;
  });
  const end = () => { s.drag = null; fig.classList.remove('is-dragging'); };
  fig.addEventListener('pointerup', end);
  fig.addEventListener('pointercancel', end);
  fig.addEventListener('pointerleave', () => { if (!s.drag) { s.px = 0; s.py = 0; } });
  new IntersectionObserver(([e]) => {
    cancelAnimationFrame(raf);
    if (e.isIntersecting) { last = 0; raf = requestAnimationFrame(tick); }
  }).observe(fig);
}

// ── Colour ──────────────────────────────────────────────────
// Text on a swatch: ink or fog, whichever reads better on that colour.
const inkOn = (hex) => {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return '';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against ink (#0a0d0c, L≈0.004) vs fog (#f3f6f1, L≈0.91).
  return (l + 0.05) / 0.054 > 0.96 / (l + 0.05) ? '#0a0d0c' : '#f3f6f1';
};
const toHex = (v) => {
  const m = v.match(/^#([0-9a-f]{6})$/i);
  return m ? `#${m[1].toUpperCase()}` : v;
};
const NATURE = [
  ['--iratze', 'Iratzea', 'Fern', 'The brand colour: calls to action, focus, the main branch.'],
  ['--goroldio', 'Goroldioa', 'Moss', 'Success, additions, staged changes.'],
  ['--itsaso', 'Itsasoa', 'Sea', 'Information, remotes, links between things.'],
  ['--txilar', 'Txilarra', 'Heather', 'Rewriting history: rebase, squash, experiments.'],
  ['--txingar', 'Txingarra', 'Ember', 'Danger, deletions, conflicts.'],
  ['--eguzki', 'Eguzkia', 'Sun', 'Warnings, tags, good first issues.'],
  ['--hezur', 'Hezurra', 'Bone', 'Antlers, illustration, highlights on night.'],
];
const swatches = $('[data-swatches]');
if (swatches) {
  swatches.innerHTML = NATURE.map(([v, eu, en, use], i) => {
    const hex = toHex(token(v));
    return `<button type="button" class="swatch reveal" style="--sw:var(${v});--delay:${i * 40}ms" data-copy="${hex}">
      <span class="swatch__chip"></span>
      <span class="swatch__name"><b lang="eu">${eu}</b> <span>${en}</span></span>
      <span class="swatch__hex mono">${hex}<span class="swatch__var">${v}</span></span>
      <span class="swatch__use">${use}</span>
      <span class="swatch__copied mono" data-label="">Copy</span>
    </button>`;
  }).join('');
  $$('.reveal', swatches).forEach(reveal);
}

const RAMPS = [
  ['Gaua · night', ['--gau-950', '--gau-900', '--gau-850', '--gau-800', '--gau-700', '--gau-600']],
  ['Lainoa · fog', ['--laino-600', '--laino-400', '--laino-200', '--laino-50']],
  ['Eguna · day', ['--egun-200', '--egun-100', '--egun-50']],
];
const ramps = $('[data-ramps]');
if (ramps) {
  ramps.innerHTML = RAMPS.map(([name, vars]) => `<div class="ramp"><p class="ramp__name">${name}</p><div class="ramp__row">${vars.map((v) => {
    const hex = toHex(token(v));
    return `<button type="button" class="ramp__step" style="--sw:var(${v});color:${inkOn(hex)}" data-copy="${hex}"><span class="mono">${v.replace('--', '')}</span><span class="mono">${hex}</span></button>`;
  }).join('')}</div></div>`).join('');
}

const SEMANTIC = [
  ['--bg', 'Page background'], ['--surface', 'Cards and panels'], ['--surface-3', 'Raised controls'],
  ['--line', 'Hairline borders'], ['--text', 'Headings, primary text'], ['--text-2', 'Body text'],
  ['--text-3', 'Secondary text'], ['--accent', 'Primary actions'], ['--accent-text', 'Accent text and links'],
  ['--success', 'Success'], ['--info', 'Information'], ['--warning', 'Warning'], ['--danger', 'Danger'],
];
const table = $('[data-tokens] tbody');
if (table) {
  const day = document.createElement('div');
  day.dataset.theme = 'light';
  day.hidden = true;
  document.body.append(day);
  const dayStyle = getComputedStyle(day);
  table.innerHTML = SEMANTIC.map(([v, role]) => {
    const n = toHex(token(v)), d = toHex(token(v, dayStyle));
    const cell = (val, theme) => `<td><button type="button" class="tok" data-copy="${val}" title="Copy ${val}"><i style="background:${val}" data-theme-swatch="${theme}"></i><span class="mono">${val}</span></button></td>`;
    return `<tr><th scope="row"><code>${v}</code></th><td>${role}</td>${cell(n, 'dark')}${cell(d, 'light')}</tr>`;
  }).join('');
  day.remove();
}

// ── Space & shape ───────────────────────────────────────────
const spacing = $('[data-spacing]');
if (spacing) {
  spacing.innerHTML = Array.from({ length: 10 }, (_, i) => {
    const v = `--space-${i + 1}`;
    return `<li><span class="mono">${v.replace('--', '')}</span><i style="width:var(${v})"></i><span class="mono muted">${token(v)}</span></li>`;
  }).join('');
}
const radii = $('[data-radii]');
if (radii) {
  radii.innerHTML = ['xs', 'sm', 'md', 'lg', 'xl', 'full'].map((r) =>
    `<span style="border-radius:var(--radius-${r})"><b class="mono">${r}</b><i class="mono">${token(`--radius-${r}`)}</i></span>`).join('');
}

// ── Motion ──────────────────────────────────────────────────
const CURVES = [
  ['--ease-grow', 'hazi', 'grow', 'Entrances, reveals, lanes drawing — fast start, long settle.', [0.16, 1, 0.3, 1]],
  ['--ease-swap', 'aldatu', 'change', 'Moving between two states, loops, toggles.', [0.65, 0, 0.35, 1]],
  ['--ease-spring', 'jauzi', 'jump', 'Small pops: nodes appearing, switches, badges.', [0.34, 1.56, 0.64, 1]],
];
const curves = $('[data-curves]');
if (curves) {
  curves.innerHTML = CURVES.map(([v, eu, en, use, [x1, y1, x2, y2]]) => {
    const P = (x, y) => `${(x * 100).toFixed(1)} ${(100 - y * 100).toFixed(1)}`;
    return `<article class="curve card">
      <svg viewBox="-8 -30 116 160" class="curve__svg" aria-hidden="true">
        <path d="M0 100H100M0 0H100" class="curve__grid"/>
        <path d="M0 100L${P(x1, y1)}M100 0L${P(x2, y2)}" class="curve__handle"/>
        <path d="M0 100C${P(x1, y1)} ${P(x2, y2)} 100 0" class="curve__path"/>
        <circle cx="${P(x1, y1).split(' ')[0]}" cy="${P(x1, y1).split(' ')[1]}" r="3" class="curve__knob"/>
        <circle cx="${P(x2, y2).split(' ')[0]}" cy="${P(x2, y2).split(' ')[1]}" r="3" class="curve__knob"/>
      </svg>
      <div class="curve__track"><i style="animation-timing-function:var(${v})"></i></div>
      <h3><span class="serif" lang="eu">${eu}</span> <span class="muted">· ${en}</span></h3>
      <p class="mono curve__val">${v}<br>cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})</p>
      <p>${use}</p>
    </article>`;
  }).join('');
}

// ── Lanes ───────────────────────────────────────────────────
const lanes = $('[data-lanes]');
if (lanes) {
  const names = ['main', 'feature', 'remote', 'rewrite', 'hotfix', 'release'];
  lanes.innerHTML = names.map((n, i) => `<span class="lane" style="--c:var(--lane-${i + 1})"><i></i><b class="mono">lane-${i + 1}</b><span>${n}</span></span>`).join('');
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
