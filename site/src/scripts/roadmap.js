// Roadmap page: the 3D git graph in the hero and the filters over the roadmap graph (which is rendered
// at build time from ROADMAP.md).
import { createScene } from './branches.js';
import { reducedMotion } from './site.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ── Hero scene ──────────────────────────────────────────────
const canvas = $('#scene');
const scene = createScene(canvas, { forms: ['graph'], count: innerWidth < 700 ? 9000 : 20000, reducedMotion });
if (scene) {
  const place = () => {
    const narrow = innerWidth < 860;
    scene.setLayout(narrow ? { x: 0.25, y: 0.1, scale: 0.62 } : { x: 0.5, y: 0, scale: 0.78 }, true);
  };
  place();
  addEventListener('resize', place);
  requestAnimationFrame(() => canvas.classList.add('is-ready'));
  let visible = true;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !document.hidden) scene.start(); else scene.stop();
  }).observe($('.rm-hero'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) scene.stop(); else if (visible) scene.start(); });
} else {
  canvas.remove();
}

// ── Filters ─────────────────────────────────────────────────
const graph = $('[data-graph]');
const state = { kind: 'all', gfi: false, q: '' };

function apply() {
  let shown = 0;
  for (const ms of $$('.rm-ms', graph)) {
    const kindOk = state.kind === 'all' || state.kind === ms.dataset.kind;
    let n = 0;
    for (const it of $$('.rm-item', ms)) {
      const ok = kindOk && (!state.gfi || it.dataset.gfi === '1') && (!state.q || it.dataset.text.includes(state.q));
      it.hidden = !ok;
      if (ok) n++;
    }
    for (const a of $$('.rm-area', ms)) a.hidden = !$('.rm-item:not([hidden])', a);
    ms.hidden = n === 0;
    shown += n;
  }
  $('.rm-head', graph).hidden = state.kind !== 'all' || state.gfi || !!state.q;
  $('[data-count]').textContent = `${shown} ${shown === 1 ? 'item' : 'items'}`;
  $('[data-empty]').hidden = shown > 0;
}

$$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
  state.kind = b.dataset.filter;
  $$('[data-filter]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  apply();
}));
const gfiToggle = $('[data-gfi-toggle]');
gfiToggle.addEventListener('change', () => { state.gfi = gfiToggle.checked; apply(); });
$('[data-search]').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); apply(); });
$$('[data-show-gfi]').forEach((b) => b.addEventListener('click', () => {
  gfiToggle.checked = true;
  state.gfi = true;
  $('[data-filter="all"]').click();
  $('.rm-list').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
}));
apply();
