// Behaviour shared by every page: navigation, scroll reveals, copy buttons, tilt cards, the star count.
import { repo, formatCount } from './github.js';

document.documentElement.classList.remove('no-js');
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Strings for scripts, in the page's language (rendered by the layout into #i18n).
let strings = {};
try { strings = JSON.parse(document.getElementById('i18n')?.textContent || '{}'); } catch { /* keep English fallbacks */ }
export const t = (key, fallback) => strings[key] ?? fallback;

// Motion can be paused from the floating toggle (remembered per browser); scenes subscribe to it.
const MOTION_KEY = 'adar:motion';
const motionListeners = new Set();
let motionPaused = false;
try { motionPaused = localStorage.getItem(MOTION_KEY) === 'paused'; } catch { /* storage unavailable */ }
export const motion = {
  get paused() { return motionPaused || reducedMotion; },
  subscribe(fn) { motionListeners.add(fn); fn(this.paused); },
};
const motionToggle = document.querySelector('[data-motion-toggle]');
function setMotionPaused(paused, remember) {
  motionPaused = paused;
  document.documentElement.classList.toggle('motion-paused', paused);
  if (motionToggle) {
    motionToggle.setAttribute('aria-pressed', String(paused));
    motionToggle.querySelector('[data-motion-label]').textContent = paused ? t('play', 'Play animations') : t('pause', 'Pause animations');
  }
  if (remember) {
    try { if (paused) localStorage.setItem(MOTION_KEY, 'paused'); else localStorage.removeItem(MOTION_KEY); } catch { /* ignore */ }
  }
  motionListeners.forEach((fn) => fn(motion.paused));
}
setMotionPaused(motionPaused, false);
motionToggle?.addEventListener('click', () => setMotionPaused(!motionPaused, true));

const announcer = document.querySelector('[data-announce]');
export function announce(text) {
  if (!announcer) return;
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = text; }, 50);
}

export function fill(key, value) {
  document.querySelectorAll(`[data-gh="${key}"]`).forEach((el) => { el.textContent = value; });
}

// Navigation
const nav = document.querySelector('.nav');
if (nav) {
  const toggle = nav.querySelector('.nav__toggle');
  const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 12);
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });
  toggle?.addEventListener('click', () => toggle.setAttribute('aria-expanded', String(nav.classList.toggle('is-open'))));
  nav.querySelectorAll('.nav__links a').forEach((a) => a.addEventListener('click', () => {
    nav.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
  }));
}

// Scroll reveals
const revealer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('is-in');
    revealer.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
export const reveal = (el) => revealer.observe(el);
document.querySelectorAll('.reveal, [data-animate]').forEach(reveal);

// Copy buttons: data-copy="text", or the <code> inside the same .code block
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = (btn.dataset.copy || btn.closest('.code')?.querySelector('code')?.textContent || '').trim();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const label = btn.querySelector('[data-label]');
  btn.classList.add('is-done');
  announce(t('copiedAnnounce', 'Copied to clipboard'));
  if (label) label.textContent = t('copied', 'Copied');
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('is-done');
    if (label) label.textContent = label.dataset.label || t('copy', 'Copy');
  }, 1600);
});

// Tilt + spotlight cards (fine pointers only)
if (!reducedMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  document.querySelectorAll('.tilt, .spotlight').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', `${x * 100}%`);
      el.style.setProperty('--my', `${y * 100}%`);
      if (!el.classList.contains('tilt')) return;
      el.classList.add('is-tilting');
      el.style.setProperty('--rx', `${(0.5 - y) * 5}deg`);
      el.style.setProperty('--ry', `${(x - 0.5) * 7}deg`);
    });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('is-tilting');
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  });
}

// Live numbers
repo().then((r) => {
  if (r.stars > 0) fill('stars', formatCount(r.stars)); // a bare "0" next to the star button helps no one
}).catch(() => {});
