"use client";

import { useEffect, useRef } from "react";

/*
 * Composed after Shishkin's "Rye": a low horizon under a big bright sky, a
 * golden rye field with an earth road running past a great oak (the prefix
 * tree) toward a hazy forest edge, and Scots pines standing in two groups.
 *
 * Black on white, like one of Shishkin's etchings: thin strokes, pine crowns
 * drawn as tufts of needles, shadows hatched.
 *
 * The scene is laid out in perspective, things hazier the further they are.
 * The oak is the prefix tree: its trunk is "pr", its boughs spell the rest
 * ("efix", "o" then "duct", "totype", "ject"), and each whole word is a crown
 * of leaves with a name plate (prefix, product, prototype, project).
 *
 * Every cell holds an amount of ink; it is drawn with the character whose
 * measured coverage in the page's mono font is closest, so tone reads
 * smoothly. Wind runs across the rye in waves, near stalks lean in gusts and
 * leaves rustle, more so around the pointer; a few birds cross the sky.
 *
 * Elements inside the hero marked `data-garden-clear` get a clearing so their
 * text stays readable; a visible `data-garden-ground` element marks where the
 * garden stops being seen (on phones, the hero card), so the tree stays above it.
 */

// ---------- deterministic noise ----------

function hash(x: number, y: number, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * f, y * f, seed + o * 17);
    f *= 2;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the ink ramp, measured in the real font ----------

/** symbols with no strong direction, so tone reads as texture, not words or strokes */
const RAMP_CANDIDATES = " .'`,-:;~\"^!+=<>*o%#&$@";
/** characters drawn on purpose: bark, branches, flowers, birds */
const GLYPHS = "()|/\\-_v*o@:'.,";

type Ink = {
  chars: string[];
  /** ink level 0..63 to an index into chars */
  lut: Uint16Array;
  index: Map<string, number>;
};

function measureInk(font: string, cw: number, ch: number): Ink {
  const W = Math.ceil(cw * 2);
  const H = Math.ceil(ch * 2);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.scale(2, 2);
  x.font = font;
  x.textAlign = "center";
  x.textBaseline = "middle";
  const cover = (s: string) => {
    x.clearRect(0, 0, W, H);
    x.fillStyle = "#000";
    x.fillText(s, cw / 2, ch / 2);
    const d = x.getImageData(0, 0, W, H).data;
    let sum = 0;
    for (let k = 3; k < d.length; k += 4) sum += d[k];
    return sum;
  };
  const ramp = [...new Set(RAMP_CANDIDATES)].map((s) => ({ s, v: cover(s) })).sort((a, b) => a.v - b.v);
  const max = ramp[ramp.length - 1].v || 1;
  const chars = [...new Set([...ramp.map((r) => r.s), ...GLYPHS])];
  const index = new Map(chars.map((s, i) => [s, i]));
  const lut = new Uint16Array(64);
  for (let k = 0; k < 64; k++) {
    const target = (k / 63) * max;
    let best = 0;
    for (let r = 1; r < ramp.length; r++) if (Math.abs(ramp[r].v - target) < Math.abs(ramp[best].v - target)) best = r;
    lut[k] = index.get(ramp[best].s)!;
  }
  return { chars, lut, index };
}

// ---------- the scene ----------

/** one ink, like an etching: black on white */
const INK = "20, 20, 20";

/** how much of a thing's tone survives the haze, by distance band (far .. near) */
const HAZE_TONE = [0.5, 0.66, 0.84, 1];

const NONE = 0;
const LEAF = 1; // rustles
const BLADE = 2; // near grass, sways
const WAVE = 3; // rye: wind runs across the field in waves
const STALK = 4; // a rye stalk up close: drawn | / \\ as it bends
const NEEDLE = 5; // pine needles: tufts of fine strokes instead of tone

/** needle strokes by tone, light to dark */
const NEEDLES = [["'", "`", "."], ["/", "\\", "-", "'"], ["/", "\\", "|", "-", "+"], ["x", "+", "*", "#"], ["#", "%", "@"]];

type Label = { text: string; x: number; y: number; strong: boolean };
type Bloom = { x: number; y: number; size: number; glyph: string };

type Scene = {
  w: number;
  h: number;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  /** ink 0 (paper) .. 1 (black) */
  lum: Float32Array;
  /** distance haze: 0 far .. 3 near */
  fog: Uint8Array;
  glyph: string[];
  anim: Uint8Array;
  phase: Float32Array;
  clear: Uint8Array;
  yh: number;
  labels: Label[];
  blooms: Bloom[];
};

type P = { x: number; y: number };

function quad(a: P, c: P, b: P, t: number): P {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function strokeChar(dx: number, dy: number) {
  const a = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const m = ((a % 180) + 180) % 180;
  if (m < 22 || m > 158) return "-";
  if (m < 68) return "/";
  if (m < 112) return "|";
  return "\\";
}

function buildScene(
  w: number,
  h: number,
  cw: number,
  ch: number,
  clearings: DOMRect[],
  groundTop: number | null,
): Scene {
  const cols = Math.ceil(w / cw);
  const rows = Math.ceil(h / ch);
  const n = cols * rows;
  const sc: Scene = {
    w,
    h,
    cols,
    rows,
    cw,
    ch,
    lum: new Float32Array(n),
    fog: new Uint8Array(n).fill(3),
    glyph: new Array(n).fill(""),
    anim: new Uint8Array(n),
    phase: new Float32Array(n),
    clear: new Uint8Array(n),
    yh: 0,
    labels: [],
    blooms: [],
  };
  const mobile = w < 640;
  const rand = mulberry32(23);

  // camera: standing at the edge of a rye field, a low horizon under a big sky (after Shishkin)
  const cx = w / 2;
  const yh = h * (mobile ? 0.5 : 0.56); // horizon
  sc.yh = yh;
  const f = h * 0.9; // focal length, px
  const camH = 1.7; // eye height, m
  const toScreen = (x: number, z: number) => ({ x: cx + (x * f) / z, y: yh + (camH * f) / z, s: f / z });

  // the prefix tree, a great oak, stands in the field beside the road
  const visibleBottom = groundTop ?? h;
  const treeBaseY = mobile ? Math.min(h * 0.66, visibleBottom - h * 0.12) : h * 0.68;
  const treeZ = (camH * f) / (treeBaseY - yh);
  const S = Math.min(treeBaseY - (mobile ? 190 : 175), (w * 0.92) / 1.45); // tree size, px
  const roadC = (z: number) => 3.2 * (1 - Math.exp(-z / 10)) - 0.4; // the road bends past the oak to the horizon
  const roadHalf = 1.05;

  const cell = (i: number, j: number) => j * cols + i;
  const cellsIn = (x0: number, y0: number, x1: number, y1: number, fn: (i: number, j: number, x: number, y: number) => void) => {
    const i0 = Math.max(0, Math.floor(x0 / cw));
    const i1 = Math.min(cols - 1, Math.ceil(x1 / cw));
    const j0 = Math.max(0, Math.floor(y0 / ch));
    const j1 = Math.min(rows - 1, Math.ceil(y1 / ch));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j, (i + 0.5) * cw, (j + 0.5) * ch);
  };
  const ink = (i: number, j: number, v: number, fog: number, anim = NONE, phase = 0) => {
    const k = cell(i, j);
    sc.lum[k] = Math.max(0, Math.min(1, v));
    sc.fog[k] = fog;
    sc.glyph[k] = "";
    sc.anim[k] = anim;
    sc.phase[k] = phase;
  };
  const mark = (i: number, j: number, g: string, fog: number) => {
    const k = cell(i, j);
    sc.glyph[k] = g;
    sc.fog[k] = fog;
    sc.anim[k] = NONE;
  };
  const fogAt = (z: number) => (z > 30 ? 0 : z > 16 ? 1 : z > 8 ? 2 : 3);

  // light from the upper left, a little toward us
  const L = (() => {
    const v = [-0.55, -0.6, 0.58];
    const l = Math.hypot(v[0], v[1], v[2]);
    return v.map((c) => c / l);
  })();

  /** a ball of leaves, shaded as a lit sphere, lumpy at the edge; tex = px per leaf cluster */
  const blob = (bx: number, by: number, rx: number, ry: number, seed: number, tex: number, fog: number, weight = 1, kind = LEAF) => {
    cellsIn(bx - rx * 1.2, by - ry * 1.2, bx + rx * 1.2, by + ry * 1.2, (i, j, x, y) => {
      const u = (x - bx) / rx;
      const v = (y - by) / ry;
      const d = Math.sqrt(u * u + v * v);
      if (d > 1.2) return;
      const ang = Math.atan2(v, u);
      const edge = 1 + 0.3 * (fbm(Math.cos(ang) * 1.8 + seed, Math.sin(ang) * 1.8 + seed, 3) - 0.5);
      if (d > edge) return;
      const dn = Math.min(1, d / edge);
      const nz = Math.sqrt(Math.max(0, 1 - dn * dn));
      const nx = (u / (d || 1)) * dn;
      const ny = (v / (d || 1)) * dn;
      const lambert = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const leaves = fbm(x / tex + seed, (y / tex) * 1.25, 11);
      const val = 0.2 + 0.62 * (1 - lambert) + 0.45 * (leaves - 0.5) + 0.12 * Math.max(0, v);
      // haze: the further away, the lighter, and the flatter its shading
      const far = HAZE_TONE[fog];
      ink(i, j, (val * far + 0.3 * (1 - far)) * far * weight, fog, kind, seed * 0.7 + fbm(i * 0.2, j * 0.2, 5) * 3);
    });
  };
  const crown = (x: number, y: number, rx: number, ry: number, seed: number, tex: number, fog: number, lumps = 5) => {
    const r = mulberry32(seed);
    const parts = [{ x, y, rx: rx * 0.78, ry: ry * 0.8 }];
    for (let k = 0; k < lumps; k++) {
      const ang = (k / lumps) * Math.PI * 2 + r() * 0.8;
      const dist = 0.38 + r() * 0.22;
      const sz = 0.42 + r() * 0.2;
      parts.push({ x: x + Math.cos(ang) * rx * dist, y: y + Math.sin(ang) * ry * dist, rx: rx * sz, ry: ry * sz * 1.05 });
    }
    parts.sort((p, q) => p.y - q.y);
    parts.forEach((p, k) => blob(p.x, p.y, p.rx, p.ry, seed * 13 + k, tex, fog));
  };
  /** a tapering limb drawn with stroke characters; bark when it is wide */
  const limb = (a: P, c: P, b: P, w0: number, w1: number, fog: number) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y);
    const steps = Math.max(6, Math.ceil(len / (Math.min(cw, ch) * 0.5)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const p = quad(a, c, b, t);
      const q = quad(a, c, b, Math.min(1, t + 0.02));
      const p0 = quad(a, c, b, Math.max(0, t - 0.02));
      const dir = strokeChar(q.x - p0.x, q.y - p0.y);
      const wd = w0 + (w1 - w0) * t;
      const half = Math.max(cw * 0.5, wd);
      cellsIn(p.x - half, p.y - ch * 0.5, p.x + half, p.y + ch * 0.5, (i, j, x, y) => {
        if (Math.abs(x - p.x) > half || Math.abs(y - p.y) > ch * 0.6) return;
        let g = dir;
        if (wd > cw * 1.2) {
          const edge = Math.abs(x - p.x) > half - cw;
          g = edge ? (x < p.x ? "(" : ")") : hash(i, j, 77) < 0.25 ? ":" : "|";
        }
        mark(i, j, g, fog);
      });
    }
  };
  /** a soft shadow on the ground, offset away from the light */
  const shaded = new Float32Array(n);
  const shadow = (x: number, y: number, rx: number, ry: number, amount: number, z = 0) => {
    if (z > 20) return; // far away, a shadow is too thin to see and only piles up on one line
    cellsIn(x - rx, Math.max(y - ry, yh + ch), x + rx, y + ry, (i, j, px, py) => {
      const u = (px - x) / rx;
      const v = (py - y) / ry;
      const d = u * u + v * v;
      if (d >= 1) return;
      const k = cell(i, j);
      if (sc.glyph[k] || sc.anim[k] === LEAF) return; // ground only
      const add = Math.min(amount * (1 - d), 0.3 - shaded[k]);
      if (add <= 0) return;
      shaded[k] += add;
      // hatched, as an etcher would: diagonal strokes, denser toward the middle
      if ((i + j) % 2 === 0 && hash(i, j, 82) < add * 3) {
        sc.glyph[k] = "/";
        sc.anim[k] = NONE;
      } else sc.lum[k] = Math.min(1, sc.lum[k] + add * 0.5);
    });
  };

  // ---------- sky: big and bright, soft cumulus gathering mid-sky ----------
  const cloud = (x: number, y: number) => fbm(x / 340, y / 120, 50) + 0.2 * (1 - Math.abs(y / yh - 0.42) * 2);
  cellsIn(0, 0, w, yh, (i, j, x, y) => {
    const c = cloud(x, y);
    const d = c - 0.66;
    if (d <= 0) return;
    const under = Math.max(0, Math.min(1, 0.5 + (cloud(x, y - 28) - c) * 6)); // denser above: the shaded underside
    const v = (0.04 + 0.22 * under) * Math.min(1, d * 8) * Math.min(1, (yh - y) / 40);
    if (v > 0.012) ink(i, j, v, 0);
  });

  // ---------- the forest edge on the horizon: a hazy saw of spruce tips ----------
  cellsIn(0, yh - 80, w, yh, (i, j, x, y) => {
    const tri = 1 - Math.abs(((x / 11) % 1) * 2 - 1);
    const spike = (4 + 20 * hash(Math.floor(x / 11), 0, 64)) * tri;
    const top = yh - (10 + 20 * fbm(x / 140, 0.5, 60) + spike);
    if (y < top) return;
    const v = 0.3 + 0.25 * (fbm(x / 7, y / 7, 62) - 0.5) + 0.15 * ((y - top) / (yh - top));
    ink(i, j, v, 0, LEAF, hash(i, j, 63) * 6);
  });

  // ---------- the ground: a rye field, an earth road with wheel ruts, grassy verges ----------
  cellsIn(0, yh + 1, w, h, (i, j, sx, sy) => {
    if (sy <= yh + 1) return; // the row straddling the horizon belongs to the forest edge
    const z = (camH * f) / (sy - yh);
    const x = ((sx - cx) * z) / f;
    const fog = fogAt(z);
    const detail = Math.min(1, 4 / z);
    const rx = x - roadC(z);
    if (Math.abs(rx) < roadHalf) {
      const rut = Math.abs(Math.abs(rx) - 0.45) < 0.09;
      ink(i, j, (rut ? 0.32 : 0.07) + 0.12 * hash(i, j, 71) * detail, fog);
      return;
    }
    if (Math.abs(rx) < roadHalf + 0.3) {
      ink(i, j, 0.3 + 0.22 * (hash(i, j, 74) - 0.5) * detail, fog, BLADE, hash(i, j, 75) * 6.28);
      return;
    }
    const v = 0.2 + 0.14 * (fbm(x * 0.4, z * 0.4, 1) - 0.5) + 0.18 * (hash(i, j, 72) - 0.5) * detail;
    const haze = Math.min(1, z / 60);
    ink(i, j, v * (1 - haze) + 0.12 * haze, fog, WAVE, x * 0.22 + z * 0.5);
  });

  // ---------- things standing in the field, drawn far to near ----------
  type Thing = { z: number; draw: () => void };
  const things: Thing[] = [];
  const zNear = (camH * f) / (h - yh);
  /** world x for a point a fraction of the way across the screen, at depth z */
  const across = (fx: number, z: number) => ((fx * w - cx) * z) / f;

  const roundTree = (x: number, z: number, height: number, seed: number) => {
    const p = toScreen(x, z);
    const fog = fogAt(z);
    const crownR = height * 0.36 * p.s;
    const trunk = height * 0.42 * p.s;
    shadow(p.x + crownR * 0.35, p.y, crownR * 1.1, Math.max(ch, crownR * 0.22), 0.25, z);
    limb({ x: p.x, y: p.y }, { x: p.x, y: p.y - trunk * 0.5 }, { x: p.x, y: p.y - trunk - crownR * 0.3 }, crownR * 0.1, crownR * 0.06, fog);
    crown(p.x, p.y - trunk - crownR * 0.55, crownR * 1.05, crownR * 0.85, seed, Math.max(3, p.s * 0.45), fog);
  };

  /** a Scots pine: a tall bare trunk, warm in the light, and flat dark clumps of needles high up */
  const pine = (x: number, z: number, height: number, seed: number) => {
    const p = toScreen(x, z);
    const fog = fogAt(z);
    const r = mulberry32(seed);
    const ht = height * p.s;
    const tw = Math.max(cw * 0.5, 0.26 * p.s);
    const lean = (r() - 0.5) * 0.1 * ht;
    const top = { x: p.x + lean, y: p.y - ht * 0.84 };
    shadow(p.x + ht * 0.08, p.y, ht * 0.14, Math.max(ch, ht * 0.025), 0.22, z);
    limb({ x: p.x, y: p.y }, { x: p.x + lean * 0.2, y: p.y - ht * 0.45 }, top, tw, tw * 0.45, fog);
    const clumps: { x: number; y: number; rx: number }[] = [];
    const count = 6 + Math.floor(r() * 3);
    for (let k = 0; k < count; k++) {
      const t = k / (count - 1);
      const y = p.y - ht * (0.68 + t * 0.32);
      const side = k % 2 ? 1 : -1;
      const x2 = top.x + side * ht * (0.04 + r() * 0.12) * (1 - t * 0.6);
      clumps.push({ x: x2, y, rx: ht * (0.1 + r() * 0.07) * (1 - t * 0.4) });
      limb({ x: top.x - lean * (1 - t) * 0.3, y: y + ht * 0.03 }, { x: (top.x + x2) / 2, y: y + ht * 0.02 }, { x: x2, y }, tw * 0.35, tw * 0.15, fog);
    }
    clumps
      .sort((a, b) => a.y - b.y)
      .forEach((c, k) => blob(c.x, c.y, c.rx, c.rx * 0.5, seed * 7 + k, Math.max(2.5, p.s * 0.3), Math.max(fog, 2), 1.25, NEEDLE));
  };

  // pines in two groups, after Shishkin's "Rye": a cluster on the left, a pair on the right
  const groups = mobile
    ? [{ fx: [0.06, 0.16], n: 2 }, { fx: [0.86, 0.96], n: 2 }]
    : [{ fx: [0.1, 0.3], n: 4 }, { fx: [0.74, 0.9], n: 3 }];
  for (const g of groups) {
    for (let k = 0; k < g.n; k++) {
      const z = 15 + rand() * 8;
      const x = across(g.fx[0] + (g.fx[1] - g.fx[0]) * (k + rand() * 0.6) / g.n, z);
      const seed = Math.floor(rand() * 999);
      const height = (mobile ? 7.5 : 9.5) + rand() * 2.5;
      things.push({ z, draw: () => pine(x, z, height, seed) });
    }
  }
  // a lone pine close by, cut by the frame
  if (!mobile) {
    const seed = Math.floor(rand() * 999);
    things.push({ z: 8, draw: () => pine(across(0.985, 8), 8, 16, seed) });
  }
  // copses far off on the horizon
  for (let k = 0; k < 9; k++) {
    const z = 45 + rand() * 30;
    const x = across(rand(), z);
    const seed = Math.floor(rand() * 999);
    const height = 6 + rand() * 4;
    things.push({ z, draw: () => roundTree(x, z, height, seed) });
  }
  // rye up close, stalk by stalk, with ears that bend in the wind
  const stalks = Math.round(w * (mobile ? 0.4 : 0.28));
  for (let k = 0; k < stalks; k++) {
    const z = zNear + rand() * rand() * 4.5;
    const x = across(rand() * 1.04 - 0.02, z);
    if (Math.abs(x - roadC(z)) < roadHalf + 0.45) continue;
    const ht = 0.75 + rand() * 0.5;
    const ear = [";", "'", ",", "*"][Math.floor(rand() * 4)];
    things.push({
      z,
      draw: () => {
        const p = toScreen(x, z);
        const i = Math.floor(p.x / cw);
        if (i < 0 || i >= cols) return;
        const fog = fogAt(z);
        const top = p.y - ht * p.s;
        for (let y = top + ch; y < p.y; y += ch) {
          const j = Math.floor(y / ch);
          if (j < 0 || j >= rows) continue;
          ink(i, j, 0.3, fog, STALK, x * 0.15 + hash(i, 0, 76) * 2.5);
        }
        const jt = Math.floor(top / ch);
        if (jt >= 0 && jt < rows) mark(i, jt, ear, fog);
      },
    });
  }
  // cornflowers, poppies and chamomile in the near rye
  for (let k = 0; k < (mobile ? 30 : 60); k++) {
    const z = zNear + rand() * 6;
    const x = across(rand(), z);
    if (Math.abs(x - roadC(z)) < roadHalf + 0.3) continue;
    const p = toScreen(x, z);
    const size = Math.max(4, Math.min(14, p.s * 0.1));
    sc.blooms.push({
      x: p.x,
      y: p.y - (0.3 + rand() * 0.6) * p.s * 0.9,
      size,
      glyph: size > 8 ? ["✽", "✻", "*"][Math.floor(rand() * 3)] : "·",
    });
  }

  // the prefix tree: trunk "pr", boughs "efix" and "o", then "duct", "totype", "ject"
  things.push({
    z: treeZ,
    draw: () => {
      const fog = 3;
      const B = { x: cx, y: treeBaseY };
      const at = (dx: number, dy: number): P => ({ x: B.x + dx * S, y: B.y - dy * S });
      const pr = at(-0.02, 0.36);
      const pro = at(0.14, 0.6);
      const words = [
        { word: "prefix", node: at(-0.42, 0.7), from: pr, edge: "efix", w0: 0.026, r: 0.19 },
        { word: "product", node: at(-0.07, 0.93), from: pro, edge: "duct", w0: 0.018, r: 0.15 },
        { word: "prototype", node: at(0.33, 0.98), from: pro, edge: "totype", w0: 0.018, r: 0.15 },
        { word: "project", node: at(0.55, 0.72), from: pro, edge: "ject", w0: 0.018, r: 0.15 },
      ];
      shadow(B.x + S * 0.14, B.y + ch * 0.3, S * 0.62, Math.max(ch, S * 0.07), 0.3);
      // root flare
      for (const dx of [-0.07, 0.07]) limb(at(dx * 0.3, 0.05), at(dx * 0.8, 0.01), at(dx * 1.6, -0.01), S * 0.012, S * 0.004, fog);
      limb(B, at(-0.04, 0.18), pr, S * 0.07, S * 0.05, fog);
      limb(pr, at(0.12, 0.45), pro, S * 0.034, S * 0.026, fog);
      for (const wd of words) {
        const ctrl = { x: wd.from.x + (wd.node.x - wd.from.x) * 0.2, y: wd.from.y + (wd.node.y - wd.from.y) * 0.6 };
        limb(wd.from, ctrl, wd.node, S * wd.w0, S * 0.008, fog);
        for (let k = -1; k <= 1; k++) {
          const tip = { x: wd.node.x + k * S * wd.r * 0.45, y: wd.node.y - S * wd.r * 0.75 };
          limb(wd.node, { x: wd.node.x + k * S * wd.r * 0.2, y: wd.node.y - S * wd.r * 0.2 }, tip, S * 0.006, S * 0.002, fog);
        }
      }
      words.forEach((wd, k) =>
        crown(wd.node.x, wd.node.y - S * wd.r * 0.3, S * wd.r * 1.25, S * wd.r * 0.85, 300 + k * 41, Math.max(4, S * 0.03), fog, 6),
      );
      sc.labels.push({ text: "pr", x: pr.x + S * 0.07, y: (B.y + pr.y) / 2, strong: false });
      sc.labels.push({ text: "o", x: (pr.x + pro.x) / 2 + S * 0.06, y: (pr.y + pro.y) / 2 + ch, strong: false });
      for (const wd of words) {
        const left = wd.node.x < wd.from.x || wd.word === "product";
        sc.labels.push({
          text: wd.edge,
          x: (wd.from.x + wd.node.x) / 2 + (left ? -S * 0.06 : S * 0.06),
          y: (wd.from.y + wd.node.y) / 2 + S * 0.04,
          strong: false,
        });
        sc.labels.push({ text: wd.word, x: wd.node.x, y: wd.node.y - S * wd.r * 0.3, strong: true });
      }
    },
  });

  things.sort((a, b) => b.z - a.z).forEach((t) => t.draw());

  // ---------- clearings behind the hero's own text ----------
  for (const r of clearings) {
    const pad = cw * 3;
    const mx = (r.left + r.right) / 2;
    const my = (r.top + r.bottom) / 2;
    const ax = r.width / 2 + pad;
    const ay = r.height / 2 + pad * 0.5;
    cellsIn(mx - ax, my - ay, mx + ax, my + ay, (i, j, x, y) => {
      const d = Math.abs((x - mx) / ax) ** 4 + Math.abs((y - my) / ay) ** 4;
      if (d < 0.7 || (d < 1 && hash(i, j, 30) < 0.5)) sc.clear[cell(i, j)] = 1;
    });
  }

  return sc;
}

// ---------- drawing ----------

const FOG_ALPHA = [0.34, 0.52, 0.74, 1];

export default function AsciiGarden({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const host = canvas.parentElement!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let scene: Scene | null = null;
    let ink: Ink | null = null;
    let atlas: HTMLCanvasElement | null = null;
    let family = "monospace";
    let dpr = 1;
    let labelFont = "";
    let edgeFont = "";
    let raf = 0;
    let last = 0;
    let visible = true;
    const pointer = { x: -1e4, y: -1e4, energy: 0 };

    const setup = () => {
      const rect = host.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const mobile = w < 640;
      const size = mobile ? 8 : 10;
      family = getComputedStyle(canvas).fontFamily || "monospace";
      const font = `300 ${size}px ${family}`; // thin strokes, like lines scratched with an etching needle
      labelFont = `${mobile ? 11 : 13}px ${family}`;
      edgeFont = `${mobile ? 10 : 11}px ${family}`;
      ctx.font = font;
      const cw = Math.max(4, ctx.measureText("M").width);
      const ch = Math.round(size * 1.15);

      ink = measureInk(font, cw, ch);

      // every character in every ink colour at every haze level, drawn once
      const cwD = Math.ceil(cw * dpr);
      const chD = Math.ceil(ch * dpr);
      atlas = document.createElement("canvas");
      atlas.width = cwD * ink.chars.length;
      atlas.height = chD * FOG_ALPHA.length;
      const a = atlas.getContext("2d")!;
      a.scale(dpr, dpr);
      a.font = font;
      a.textAlign = "center";
      a.textBaseline = "middle";
      FOG_ALPHA.forEach((al, row) => {
        a.fillStyle = `rgba(${INK}, ${al})`;
        ink!.chars.forEach((c, k) => a.fillText(c, (k * cwD) / dpr + cw / 2, (row * chD) / dpr + ch / 2));
      });

      const clearings = Array.from(host.querySelectorAll<HTMLElement>("[data-garden-clear]"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return new DOMRect(r.left - rect.left, r.top - rect.top, r.width, r.height);
        });
      const groundEl = host.querySelector<HTMLElement>("[data-garden-ground]");
      const groundTop =
        groundEl && groundEl.offsetParent !== null ? groundEl.getBoundingClientRect().bottom - rect.top : null;

      scene = buildScene(w, h, cw, ch, clearings, groundTop);
      draw(performance.now());
    };

    const draw = (now: number) => {
      const sc = scene;
      if (!sc || !ink || !atlas) return;
      const t = reduced ? 0 : now / 1000;
      const cwD = Math.ceil(sc.cw * dpr);
      const chD = Math.ceil(sc.ch * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const pcol = pointer.x / sc.cw;
      const prow = pointer.y / sc.ch;
      const gustR = 14;

      for (let j = 0; j < sc.rows; j++) {
        for (let i = 0; i < sc.cols; i++) {
          const k = j * sc.cols + i;
          if (sc.clear[k]) continue;
          let ci: number;
          const g = sc.glyph[k];
          if (g) {
            ci = ink.index.get(g) ?? 0;
          } else {
            let v = sc.lum[k];
            const an = sc.anim[k];
            if (an !== NONE && !reduced) {
              let gust = 0;
              if (pointer.energy > 0.01) {
                const dx = (i - pcol) / gustR;
                const dy = ((j - prow) * 2) / gustR;
                const d2 = dx * dx + dy * dy;
                if (d2 < 1) gust = (1 - d2) * pointer.energy;
              }
              const wind = Math.sin(i * 0.05 - t * 0.8) * 0.5 + 0.5;
              if (an === LEAF || an === NEEDLE) v += Math.sin(sc.phase[k] + t * (1.3 + gust * 7)) * (0.04 + wind * 0.05 + gust * 0.2);
              else if (an === WAVE) v += Math.sin(sc.phase[k] - t * 1.3) * 0.09 + gust * 0.12;
              else if (an === STALK) {
                // mostly upright; a stalk leans only at the crest of a gust
                const sway = Math.sin(sc.phase[k] - t * 1.1) + gust * 1.5;
                ci = ink.index.get(sway > 0.85 ? "/" : sway < -0.92 ? "\\" : "|") ?? 0;
                const row = sc.fog[k];
                ctx.drawImage(atlas, ci * cwD, row * chD, cwD, chD, Math.round(i * sc.cw * dpr), Math.round(j * sc.ch * dpr), cwD, chD);
                continue;
              } else v += Math.sin(sc.phase[k] + t * (1.5 + gust * 6) + wind * 2) * (0.06 + gust * 0.15);
            }
            v = 0.9 * Math.max(0, v) ** 1.6; // paper should dominate
            if (v < 0.02) continue;
            if (an === NEEDLE) {
              const set = NEEDLES[Math.min(NEEDLES.length - 1, Math.floor(v * NEEDLES.length * 1.15))];
              ci = ink.index.get(set[Math.floor(hash(i, j, 81) * set.length)]) ?? 0;
            } else ci = ink.lut[Math.min(63, Math.round(v * 63))];
          }
          if (ci === 0 && !g) continue;
          const row = sc.fog[k];
          ctx.drawImage(atlas, ci * cwD, row * chD, cwD, chD, Math.round(i * sc.cw * dpr), Math.round(j * sc.ch * dpr), cwD, chD);
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // blossoms, nodding a little in the wind
      for (const b of sc.blooms) {
        ctx.font = `${Math.round(b.size)}px ${family}`;
        ctx.fillStyle = `rgba(${INK}, 0.7)`;
        const nod = reduced ? 0 : Math.sin(t * 1.4 + b.x * 0.05) * b.size * 0.08;
        ctx.fillText(b.glyph, b.x + nod, b.y);
      }

      // a few birds crossing the sky
      ctx.font = edgeFont;
      ctx.fillStyle = "rgba(23, 23, 23, 0.6)";
      for (let b = 0; b < 3; b++) {
        const span = sc.w + 160;
        const bx = ((t * (14 + b * 5) + b * 380) % span) - 80;
        const by = sc.h * (0.16 + b * 0.05) + Math.sin(t * 0.6 + b * 2) * 8;
        ctx.fillText(Math.sin(t * 5 + b * 1.7) > 0 ? "v" : "-", bx, by);
      }

      // name plates, larger than the garden's own characters
      for (const l of sc.labels) {
        ctx.font = l.strong ? labelFont : edgeFont;
        if (l.strong) {
          // the words: a soft rounded plate
          const tw = ctx.measureText(l.text).width;
          ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
          ctx.beginPath();
          ctx.roundRect(l.x - tw / 2 - 6, l.y - 9, tw + 12, 18, 9);
          ctx.fill();
          ctx.fillStyle = "rgba(23, 23, 23, 0.95)";
        } else {
          // the pieces of words along the boughs: a halo, no plate
          ctx.lineWidth = 4;
          ctx.lineJoin = "round";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
          ctx.strokeText(l.text, l.x, l.y + 0.5);
          ctx.fillStyle = `rgba(${INK}, 0.6)`;
        }
        ctx.fillText(l.text, l.x, l.y + 0.5);
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < 110) return; // ~9 fps: ASCII should tick, not glide
      last = now;
      pointer.energy *= 0.9;
      draw(now);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.energy = Math.min(1, pointer.energy + 0.25);
    };

    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(setup, 80);
    });
    ro.observe(host);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);

    document.fonts?.ready.then(setup);
    setup();
    if (!reduced) {
      raf = requestAnimationFrame(loop);
      host.addEventListener("pointermove", onMove);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 font-mono ${className}`}
    />
  );
}
