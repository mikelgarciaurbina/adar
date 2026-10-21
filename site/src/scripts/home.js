// Landing page: drives the 3D scene from the scroll position, the app screenshot tilt, the terminal
// demo and the platform note in the download section.
import { createScene } from './branches.js';
import { reducedMotion, motion, t } from './site.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const $ = (s, el = document) => el.querySelector(s);

// ── Scene ───────────────────────────────────────────────────
const canvas = $('#scene');
const zone = $('#zone');
const nameSection = $('[data-name-section]');
const senses = [...document.querySelectorAll('[data-sense]')];
const steps = [...document.querySelectorAll('.name__steps span')];
const fig = $('[data-fig]');
const FIGS = t('figs', ['fig. 1 — orein adarrak · a deer’s antlers', 'fig. 2 — zuhaitzaren adarra · a tree branch', 'fig. 3 — git log --graph']);
// Scroll progress through the name section → morph value (0 antlers, 1 tree, 2 graph), with holds.
const KEYS = [[0, 0], [0.14, 0], [0.38, 1], [0.56, 1], [0.8, 2], [1, 2]];

const scene = createScene(canvas, { reducedMotion });
let zoneVisible = true;
let inName = false;
if (!scene) {
  document.documentElement.classList.add('no-webgl');
} else {
  $('[data-points]').textContent = scene.count.toLocaleString(document.documentElement.lang);
  layout(true);
  motion.subscribe((p) => scene.setPaused(p));
  requestAnimationFrame(() => canvas.classList.add('is-ready'));
  // After the fade-in, the scene's opacity follows the scroll position directly.
  setTimeout(() => canvas.classList.add('is-live'), 1300);
  new IntersectionObserver(([e]) => {
    zoneVisible = e.isIntersecting;
    if (zoneVisible && !document.hidden) scene.start(); else scene.stop();
  }).observe(zone);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) scene.stop(); else if (zoneVisible) scene.start();
  });
  addEventListener('resize', () => layout(false));
}

// On phones the structure sits above the text: in the hero it frames the title, in the name section it
// has to fit above the dictionary entry.
function layout(instant) {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  if (w < 860) {
    const s = clamp(aspect * (inName ? 1.0 : 1.2), 0.4, 0.75);
    scene.setLayout({ x: 0, y: inName ? 0.46 : 0.36, scale: s }, instant);
  } else scene.setLayout({ x: w > 1400 ? 0.36 : 0.4, y: -0.05, scale: clamp((0.58 * 4.36 * aspect) / 3.2, 0.66, 0.84) }, instant);
}

function morphAt(p) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a, va] = KEYS[i], [b, vb] = KEYS[i + 1];
    if (p <= b) return va + (vb - va) * ((p - a) / (b - a || 1));
  }
  return 2;
}

let sense = 0;
function setSense(i) {
  if (i === sense) return;
  sense = i;
  senses.forEach((el, k) => el.classList.toggle('is-active', k === i));
  steps.forEach((el, k) => el.classList.toggle('is-active', k === i));
  if (fig) fig.textContent = FIGS[i];
}

// ── Screenshot tilt ─────────────────────────────────────────
const shot = $('[data-shot]');

// ── The night sky: dark at the top, the blue hour in the middle, dawn at the download ────────────
const sky = $('.sky');
const dawnAt = $('[data-dawn]');
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ── Chapter rail ────────────────────────────────────────────
const rail = $('[data-rail]');
const railLinks = rail ? [...rail.querySelectorAll('[data-chapter]')] : [];
const chapters = railLinks.map((a) => document.getElementById(a.dataset.chapter)).filter(Boolean);
if (rail && chapters.length) {
  // The chapter crossing the middle of the viewport is the current one.
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = chapters.indexOf(e.target);
      railLinks.forEach((a, k) => {
        a.classList.toggle('is-done', k < i);
        if (k === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
      });
      rail.classList.toggle('is-on', i > 0);
    }
  }, { rootMargin: '-48% 0px -48% 0px' });
  chapters.forEach((c) => spy.observe(c));
  // Off at the footer, where the story is over.
  new IntersectionObserver(([e]) => { if (e.isIntersecting) rail.classList.remove('is-on'); }).observe($('.footer'));
}

let queued = false;
function update() {
  queued = false;
  const r = nameSection.getBoundingClientRect();
  const p = clamp(-r.top / (r.height - innerHeight), 0, 1);
  const m = morphAt(p);
  scene?.setMorph(m);
  if (scene && inName !== r.top < innerHeight * 0.5) { inName = !inName; layout(false); }
  setSense(m < 0.5 ? 0 : m < 1.5 ? 1 : 2);

  // The 3D scene belongs to the first two chapters; it fades into the sky as the trunk comes up.
  if (scene) {
    const z = zone.getBoundingClientRect();
    const fade = clamp((z.bottom - innerHeight * 0.35) / (innerHeight * 0.45), 0, 1);
    canvas.style.opacity = canvas.classList.contains('is-live') || fade < 1 ? fade.toFixed(3) : '';
  }
  if (sky && dawnAt) {
    const top = dawnAt.getBoundingClientRect().top + scrollY;
    const t = clamp(scrollY / Math.max(1, top - innerHeight * 0.3), 0, 1);
    sky.style.setProperty('--stars', (1 - smooth(0.45, 0.85, t)).toFixed(3));
    sky.style.setProperty('--deep', (smooth(0.2, 0.55, t) * (1 - smooth(0.7, 1, t))).toFixed(3));
    sky.style.setProperty('--dawn', smooth(0.62, 1, t).toFixed(3));
    sky.style.setProperty('--sun', smooth(0.8, 1, t).toFixed(3));
  }

  if (shot) {
    const s = shot.getBoundingClientRect();
    const tilt = reducedMotion ? 0 : clamp((s.top - innerHeight * 0.12) / (innerHeight * 0.68), 0, 1);
    shot.style.setProperty('--tilt', tilt.toFixed(4));
    shot.classList.toggle('is-flat', tilt < 0.06);
  }
}
addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
update();

// ── Terminal demo ───────────────────────────────────────────
const term = $('[data-term-body]');
const SCRIPT = [
  { cmd: 'cd ~/code/shop/api' },
  { cmd: 'adar' },
  { out: '<span class="ok">✓</span> Opened <b>api</b> in a new tab' },
  { cmd: 'cd .. && ls' },
  { out: '<span class="dim">api    app    landing</span>' },
  { cmd: 'adar .' },
  { out: '<span class="ok">✓</span> 3 repositories → tab group <span class="grp">“shop”</span>' },
  { out: '<span class="dim">  api · app · landing</span>' },
];
if (term) {
  const render = (lines) => { term.innerHTML = lines.join('\n'); };
  const prompt = (text) => `<span class="p">❯</span> ${text}`;
  const play = async () => {
    const lines = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, motion.paused ? 0 : ms));
    for (const step of SCRIPT) {
      if (step.out) { lines.push(step.out); render(lines); await wait(260); continue; }
      lines.push(prompt(''));
      for (let i = 1; i <= step.cmd.length; i++) {
        lines[lines.length - 1] = prompt(step.cmd.slice(0, i).replace(/&/g, '&amp;'));
        render(lines);
        await wait(38 + Math.random() * 50);
      }
      await wait(380);
    }
    lines.push(prompt(''));
    render(lines);
  };
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    play();
  }, { threshold: 0.4 });
  io.observe(term.closest('[data-term]'));
}

// ── Download ────────────────────────────────────────────────
// The links are rendered at build time; only the note for visitors on other systems is decided here.
const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;
if (!isMac) $('[data-dl="platform"]').hidden = false;
