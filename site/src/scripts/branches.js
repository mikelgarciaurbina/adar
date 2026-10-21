// The hero scene: one cloud of glowing points that grows into a pair of deer antlers and, as the page
// scrolls, re-forms into a tree branch and then into a git graph — the three meanings of "adar".
// Plain WebGL2, no libraries. createScene() returns null when WebGL2 is not available.

// ── Math ────────────────────────────────────────────────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unit(R) {
  const z = R() * 2 - 1;
  const a = R() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}

// Rotates v around a unit axis by angle (Rodrigues).
function rotate(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const k = cross(axis, v);
  return [0, 1, 2].map((i) => v[i] * c + k[i] * s + axis[i] * d * (1 - c));
}

// ── Curves ──────────────────────────────────────────────────
function spline(ctrl, perSegment = 18) {
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((j) =>
        0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
          (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

function bezier(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([0, 1, 2].map((j) => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j]));
  }
  return out;
}

const segment = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, k) => mix(a, b, k / n));
const join = (...parts) => parts.reduce((acc, p) => acc.concat(acc.length ? p.slice(1) : p), []);

class Strand {
  constructor(pts, o) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + len(sub(pts[i], pts[i - 1])));
    this.len = this.cum[this.cum.length - 1];
    this.r0 = o.r0 ?? 0.04;
    this.r1 = o.r1 ?? this.r0 * 0.4;
    this.c0 = o.c0;
    this.c1 = o.c1 ?? o.c0;
    this.t0 = o.parent ? o.parent.t0 + o.parent.len * (o.at ?? 1) : (o.t0 ?? 0);
  }
  at(u) {
    const d = Math.min(Math.max(u, 0), 1) * this.len;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= d) lo = m; else hi = m;
    }
    const span = this.cum[hi] - this.cum[lo] || 1;
    return mix(this.pts[lo], this.pts[hi], (d - this.cum[lo]) / span);
  }
  get end() { return this.pts[this.pts.length - 1]; }
  get t1() { return this.t0 + this.len; }
}

class Form {
  constructor() { this.strands = []; this.nodes = []; }
  strand(pts, o) { const s = new Strand(pts, o); this.strands.push(s); return s; }
  node(p, r, c, t) { this.nodes.push({ p, r, c, t }); }
  // Uniformly scales and centres the form: height h, at most w wide, root at the bottom.
  fit(h = 3.5, w = 3.3) {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const grow = (p) => { for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); } };
    this.strands.forEach((s) => s.pts.forEach(grow));
    this.nodes.forEach((n) => grow(n.p));
    const k = Math.min(h / (max[1] - min[1]), w / (max[0] - min[0]));
    const c = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
    const T = (p) => [(p[0] - c[0]) * k, (p[1] - c[1]) * k - h / 2, (p[2] - c[2]) * k];
    for (const s of this.strands) {
      s.pts = s.pts.map(T);
      s.cum = s.cum.map((d) => d * k);
      s.len *= k;
      s.t0 *= k;
    }
    for (const n of this.nodes) { n.p = T(n.p); n.t *= k; }
    return this;
  }
}

// ── Palette (Basoa) ─────────────────────────────────────────
const C = {
  bone: hex('#eee6d4'), fern: hex('#c5f56a'), moss: hex('#46e2b4'), sea: hex('#6cb4ff'),
  heather: hex('#b595ff'), ember: hex('#ff8c5f'), sun: hex('#ffd36e'), bark: hex('#b48c62'),
  sprout: hex('#e6ffa8'),
};

// ── Forms ───────────────────────────────────────────────────
function antlers() {
  const f = new Form();
  const root = [0, -1.75, 0];
  const fork = [0, -1.3, 0];
  const bone = mul(C.bone, 0.72);
  const stem = f.strand(segment(root, fork, 10), { r0: 0.085, r1: 0.08, c0: bone });
  f.node(root, 0.1, C.moss, 0);
  for (const s of [1, -1]) {
    const X = (p) => [p[0] * s, p[1], p[2]];
    const beam = f.strand(spline([fork, X([0.34, -1.1, -0.04]), X([0.84, -0.74, -0.16]), X([1.2, -0.15, -0.28]),
      X([1.32, 0.55, -0.3]), X([1.24, 1.2, -0.18]), X([1.0, 1.72, 0.02])]),
      { r0: 0.078, r1: 0.03, c0: bone, c1: mix(bone, C.fern, 0.7), parent: stem });
    f.node(beam.end, 0.078, C.fern, beam.t1);
    // [where on the beam, two offsets for the tine's shape, radius]
    const tines = [
      [0.3, [-0.04, 0.24, 0.34], [-0.1, 0.56, 0.56], 0.046],
      [0.5, [-0.24, 0.34, 0.12], [-0.5, 0.82, 0.16], 0.05],
      [0.62, [-0.18, 0.3, 0.06], [-0.3, 0.62, 0.08], 0.038],
      [0.8, [-0.16, 0.26, 0.04], [-0.28, 0.5, 0.05], 0.032],
      [0.9, [0.12, 0.24, -0.06], [0.2, 0.46, -0.1], 0.028],
    ];
    for (const [u, d1, d2, r] of tines) {
      const p = beam.at(u);
      const t = f.strand(spline([p, add(p, X(mul(d1, 0.5))), add(p, X(d1)), add(p, X(d2))], 14),
        { r0: r, r1: r * 0.32, c0: bone, c1: mix(bone, C.fern, 0.85), parent: beam, at: u });
      f.node(t.end, 0.064, C.fern, t.t1);
    }
  }
  return f.fit();
}

function tree() {
  const f = new Form();
  const R = rng(11);
  const MAX = 4;
  function grow(start, dir, length, r, depth, parent, at) {
    const side = norm(cross(dir, Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const wob = rotate(side, dir, R() * Math.PI * 2);
    const end = add(add(start, mul(dir, length)), mul(wob, length * 0.08));
    const pts = spline([start, add(add(start, mul(dir, length * 0.35)), mul(wob, length * 0.07)),
      add(add(start, mul(dir, length * 0.7)), mul(wob, -length * 0.03)), end], 12);
    const t = depth / MAX;
    const s = f.strand(pts, {
      r0: r, r1: r * 0.7, c0: mix(C.bark, C.moss, t * 0.8), c1: mix(C.bark, C.fern, Math.min(1, t + 0.3)),
      parent, at, t0: 0,
    });
    if (depth === MAX) { f.node(end, 0.058, R() < 0.25 ? C.sun : mix(C.fern, C.sprout, R()), s.t1); return; }
    if (depth > 0) f.node(end, 0.045, C.moss, s.t1);
    const n = depth === 0 ? 3 : R() < 0.3 ? 3 : 2;
    const az0 = R() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const axis = rotate(side, dir, az0 + (i / n) * Math.PI * 2 + (R() - 0.5) * 0.6);
      let d = rotate(dir, axis, 0.48 + R() * 0.32);
      d = norm(add(d, [0, 0.3, 0]));
      grow(end, d, length * (0.68 + R() * 0.1), r * 0.64, depth + 1, s, 1);
    }
  }
  grow([0, -1.75, 0], [0, 1, 0], 1.05, 0.09, 0, null, 0);
  return f.fit(3.5, 3.4);
}

function graph() {
  const f = new Form();
  const bottom = -1.75, top = 1.75, step = 0.25;
  f.strand(segment([0, bottom, 0], [0, top, 0], 60), { r0: 0.03, r1: 0.03, c0: C.fern });
  for (let y = bottom; y <= top + 1e-6; y += step) f.node([0, y, 0], y > top - 0.01 ? 0.095 : 0.07, C.fern, y - bottom);
  const lanes = [
    { x: 0.55, z: 0.22, from: -1.5, to: -0.75, c: C.moss, commits: [-1.2, -0.98] },
    { x: -0.55, z: 0.22, from: -1.25, to: -0.25, c: C.heather, commits: [-0.95, -0.7, -0.48] },
    { x: 1.1, z: -0.12, from: -0.5, to: 0.5, c: C.sea, commits: [-0.2, 0.05, 0.25] },
    { x: 0.55, z: 0.22, from: 0, to: null, c: C.ember, commits: [0.3, 0.55, 0.8, 1.05, 1.3, 1.55] },
    { x: -0.55, z: 0.22, from: 0.25, to: 1.0, c: C.sun, commits: [0.55, 0.78] },
    { x: -1.1, z: -0.12, from: 0.75, to: null, c: C.heather, commits: [1.05, 1.3, 1.55] },
  ];
  const bend = 0.26;
  for (const l of lanes) {
    const tip = l.to ?? l.commits[l.commits.length - 1];
    const parts = [bezier([0, l.from, 0], [0, l.from + 0.16, 0], [l.x, l.from + 0.08, l.z], [l.x, l.from + bend, l.z])];
    parts.push(segment([l.x, l.from + bend, l.z], [l.x, l.to == null ? tip : l.to - bend, l.z], 24));
    if (l.to != null) parts.push(bezier([l.x, l.to - bend, l.z], [l.x, l.to - 0.08, l.z], [0, l.to - 0.16, 0], [0, l.to, 0]));
    const s = f.strand(join(...parts), { r0: 0.024, r1: 0.024, c0: l.c, t0: l.from - bottom });
    for (const y of l.commits) f.node([l.x, y, l.z], 0.064, l.c, s.t0 + (y - l.from) * 1.1);
  }
  return f.fit(3.5, 3.0);
}

export const FORMS = { antlers, tree, graph };

// ── Sampling ────────────────────────────────────────────────
function sampleForm(form, nStrand, nNode, R) {
  const parts = [];
  const weights = form.strands.map((s) => s.len * (s.r0 + s.r1 + 0.035));
  const total = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((w / total) * nStrand));
  for (let i = 0, left = nStrand - counts.reduce((a, b) => a + b, 0); left > 0; i++, left--) counts[i % counts.length]++;
  form.strands.forEach((s, i) => {
    const count = counts[i];
    for (let k = 0; k < count; k++) {
      const u = (k + R()) / count;
      const r = s.r0 + (s.r1 - s.r0) * u;
      const core = R() < 0.36;
      const off = mul(unit(R), core ? r * 0.18 * R() : r * Math.sqrt(R()));
      const c = mix(s.c0, s.c1, Math.pow(u, 1.4));
      parts.push({
        p: add(s.at(u), off), c: mul(c, core ? 1 : 0.5 + R() * 0.25),
        size: core ? 0.85 + R() * 0.35 : 0.7 + R() * 0.45, t: s.t0 + s.len * u,
      });
    }
  });
  const nodes = form.nodes;
  for (let k = 0; k < nNode; k++) {
    const n = nodes[k % nodes.length];
    const shell = R() < 0.62;
    const off = mul(unit(R), shell ? n.r * (0.82 + 0.18 * R()) : n.r * 0.4 * R());
    parts.push({ p: add(n.p, off), c: mul(n.c, shell ? 0.95 : 1.2), size: shell ? 0.9 + R() * 0.3 : 1.2 + R() * 0.4, t: n.t, node: true });
  }
  // Same-rank particles travel between forms, so sort each category by height: the morph reads as
  // a reshaping instead of noise.
  const byY = (a, b) => a.p[1] + a.j - (b.p[1] + b.j);
  parts.forEach((p) => { p.j = (R() - 0.5) * 0.25; });
  const strands = parts.filter((p) => !p.node).sort(byY);
  const nodeParts = parts.filter((p) => p.node).sort(byY);
  return strands.concat(nodeParts);
}

// ── WebGL ───────────────────────────────────────────────────
const POINT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA;
layout(location=1) in vec3 aB;
layout(location=2) in vec3 aC;
layout(location=3) in vec3 cA;
layout(location=4) in vec3 cB;
layout(location=5) in vec3 cC;
layout(location=6) in vec4 aR;
layout(location=7) in vec2 aS;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uMorph, uTime, uGrow, uPx, uGain, uSize, uFly, uMotion, uScale;
uniform vec2 uShift;
out vec3 vC;
out float vA;
float ease(float t) { return t * t * (3.0 - 2.0 * t); }
void main() {
  float d = aR.x * 0.45;
  float tAB = ease(clamp((uMorph - d) / 0.55, 0.0, 1.0));
  float tBC = ease(clamp((uMorph - 1.0 - d) / 0.55, 0.0, 1.0));
  vec3 p = mix(mix(aA, aB, tAB), aC, tBC);
  vec3 col = mix(mix(cA, cB, tAB), cC, tBC);
  float fly = sin(3.14159 * tAB) + sin(3.14159 * tBC);
  vec3 dir = aR.yzw * 2.0 - 1.0;
  p += dir * fly * uFly;
  float ang = fly * (aR.x - 0.5) * 1.6;
  p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
  p.y += fly * 0.18 * (aR.z - 0.3);
  p += uMotion * 0.012 * sin(uTime * vec3(0.9, 0.7, 0.8) + aR.yzw * 40.0);
  float g = clamp((uGrow - aS.y) / 0.05, 0.0, 1.0);
  float front = (1.0 - clamp((uGrow - aS.y) / 0.12, 0.0, 1.0)) * step(uGrow, 1.0);
  vec4 mv = uView * vec4(p * uScale, 1.0);
  gl_Position = uProj * mv;
  gl_Position.xy += uShift * gl_Position.w;
  gl_PointSize = clamp(aS.x * uSize * uScale * uPx / -mv.z * g, 0.0, 96.0);
  vC = col * uGain * (1.0 + front * 2.5 + fly * 0.35);
  vA = g;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vC;
in float vA;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float a = max(exp(-r2 * 3.6) - 0.027, 0.0);
  o = vec4(vC * a * vA, 1.0);
}`;

const BG_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes, uCenter;
uniform vec3 uBg, uGlow;
out vec4 o;
void main() {
  vec2 p = (vUv - uCenter) * vec2(uRes.x / uRes.y, 1.0);
  float g = exp(-dot(p, p) * 2.4);
  vec3 c = uBg + uGlow * g * 0.55;
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.6;
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

// View = translate(0, 0, -dist) · rotX(pitch) · rotY(yaw), column-major.
function view(yaw, pitch, dist) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
  return new Float32Array([cy, sx * sy, -cx * sy, 0, 0, cx, sx, 0, sy, -sx * cy, cx * cy, 0, 0, 0, -dist, 1]);
}

const GLOWS = [hex('#2a3a1c'), hex('#183626'), hex('#132a33')];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ forms?: string[], count?: number, background?: string, reducedMotion?: boolean }} [opts]
 */
export function createScene(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, powerPreference: 'high-performance',
    preserveDrawingBuffer: /[?&]capture\b/.test(location.search), // lets screenshot tools read the canvas
  });
  if (!gl) return null;
  const reduced = opts.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(screen.width, screen.height) < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const N = opts.count ?? (small ? 17000 : 38000);
  const nDust = Math.round(N * 0.1), nNode = Math.round(N * 0.16), nStrand = N - nDust - nNode;
  const names = opts.forms ?? ['antlers', 'tree', 'graph'];
  while (names.length < 3) names.push(names[names.length - 1]);

  let pts, bg;
  try {
    pts = program(gl, POINT_VS, POINT_FS);
    bg = program(gl, BG_VS, BG_FS);
  } catch (e) {
    console.warn('Adar scene disabled:', e);
    return null;
  }

  // Geometry
  const R = rng(2026);
  const sets = names.map((name) => sampleForm(FORMS[name](), nStrand, nNode, R));
  const dust = Array.from({ length: nDust }, () => {
    const d = unit(R), r = 0.35 + Math.cbrt(R()) * 0.65;
    return { p: [d[0] * 3.8 * r, d[1] * 2.6 * r, d[2] * 2.4 * r - 0.4], c: mul(C.bone, 0.16 + R() * 0.18), size: 0.5 + R() * 0.5, t: R() * 0.9 };
  });
  const maxT = Math.max(...sets[0].map((p) => p.t)) || 1;
  const pos = sets.map(() => new Float32Array(N * 3));
  const col = sets.map(() => new Float32Array(N * 3));
  const rnd = new Float32Array(N * 4);
  const sz = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const isDust = i >= nStrand + nNode;
    sets.forEach((set, f) => {
      const q = isDust ? dust[i - nStrand - nNode] : set[i];
      pos[f].set(q.p, i * 3);
      col[f].set(q.c, i * 3);
    });
    const a = isDust ? dust[i - nStrand - nNode] : sets[0][i];
    rnd.set([R(), R(), R(), R()], i * 4);
    sz.set([a.size * 0.021, isDust ? a.t : (a.t / maxT) * 0.96], i * 2);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attrs = [[pos[0], 3], [pos[1], 3], [pos[2], 3], [col[0], 3], [col[1], 3], [col[2], 3], [rnd, 4], [sz, 2]];
  attrs.forEach(([data, size], loc) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  });
  gl.bindVertexArray(null);
  const bgVao = gl.createVertexArray();

  const bgColor = hex(opts.background ?? '#0a0d0c');
  const FOV = (32 * Math.PI) / 180, DIST = 7.6;
  const state = {
    morph: 0, morphTarget: 0, grow: reduced ? 1.2 : -0.04,
    shift: [0, 0], shiftTarget: [0, 0], scale: 1, scaleTarget: 1,
    px: 0, py: 0, pxTarget: 0, pyTarget: 0, time: 0,
  };
  let raf = 0, last = 0, running = false, w = 0, h = 0, dpr = 1;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75);
    w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    state.time += dt;
    const k = (rate) => 1 - Math.exp(-dt * rate);
    state.morph += (state.morphTarget - state.morph) * k(reduced ? 20 : 3.2);
    state.shift[0] += (state.shiftTarget[0] - state.shift[0]) * k(4);
    state.shift[1] += (state.shiftTarget[1] - state.shift[1]) * k(4);
    state.scale += (state.scaleTarget - state.scale) * k(4);
    state.px += (state.pxTarget - state.px) * k(2.5);
    state.py += (state.pyTarget - state.py) * k(2.5);
    if (state.grow < 1.2) state.grow += dt / 3.6;
    draw();
  }

  function draw() {
    resize();
    gl.viewport(0, 0, w, h);
    const m = state.morph;
    const f = Math.min(1.999, Math.max(0, m));
    const glow = mix(GLOWS[Math.floor(f)], GLOWS[Math.floor(f) + 1], f % 1);
    gl.disable(gl.BLEND);
    gl.useProgram(bg.p);
    gl.uniform2f(bg.u.uRes, w, h);
    gl.uniform2f(bg.u.uCenter, 0.5 + state.shift[0] * 0.5, 0.5 + state.shift[1] * 0.5);
    gl.uniform3fv(bg.u.uBg, bgColor);
    gl.uniform3fv(bg.u.uGlow, glow);
    gl.bindVertexArray(bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const t = state.time;
    const turning = Math.sin(Math.PI * (m % 1)) * (m > 0.001 && m < 1.999 ? 1 : 0);
    const yaw = (reduced ? 0 : Math.sin(t * 0.13) * 0.42) + state.px * 0.45 + turning * 0.9;
    const pitch = 0.06 + state.py * 0.16;
    gl.useProgram(pts.p);
    gl.uniformMatrix4fv(pts.u.uView, false, view(yaw, pitch, DIST));
    gl.uniformMatrix4fv(pts.u.uProj, false, perspective(FOV, w / h, 0.1, 50));
    gl.uniform1f(pts.u.uMorph, m);
    gl.uniform1f(pts.u.uTime, t);
    gl.uniform1f(pts.u.uGrow, state.grow);
    gl.uniform1f(pts.u.uPx, h / (2 * Math.tan(FOV / 2)));
    gl.uniform1f(pts.u.uGain, 0.62);
    gl.uniform1f(pts.u.uSize, 1);
    gl.uniform1f(pts.u.uFly, reduced ? 0.15 : 0.55);
    gl.uniform1f(pts.u.uMotion, reduced ? 0 : 1);
    gl.uniform1f(pts.u.uScale, state.scale);
    gl.uniform2f(pts.u.uShift, state.shift[0], state.shift[1]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, N);
    // Soft halos around the commit nodes (they are the last nStrand..nStrand+nNode points).
    gl.uniform1f(pts.u.uSize, 5.5);
    gl.uniform1f(pts.u.uGain, 0.022);
    gl.drawArrays(gl.POINTS, nStrand, nNode);
    gl.bindVertexArray(null);
  }

  function onPointer(e) {
    if (reduced) return;
    state.pxTarget = (e.clientX / innerWidth) * 2 - 1;
    state.pyTarget = (e.clientY / innerHeight) * 2 - 1;
  }
  addEventListener('pointermove', onPointer, { passive: true });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); api.stop(); opts.onLost?.(); });

  const api = {
    count: N,
    start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    /** 0 = first form, 1 = second, 2 = third (fractions blend). */
    setMorph(v) { state.morphTarget = Math.max(0, Math.min(2, v)); },
    /** Where the structure sits: shift in clip space (-1..1) and a scale factor. */
    setLayout({ x = 0, y = 0, scale = 1 }, instant = false) {
      state.shiftTarget = [x, y];
      state.scaleTarget = scale;
      if (instant) { state.shift = [x, y]; state.scale = scale; }
    },
    get morph() { return state.morph; },
  };
  return api;
}
