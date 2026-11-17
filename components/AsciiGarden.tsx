"use client";

import { useEffect, useRef } from "react";

/*
 * The world as a garden, drawn in black ASCII on paper, as you would see it
 * standing on its path.
 *
 * The scene is laid out in perspective: a lawn in mown stripes and a gravel
 * path with flower beds run to a far tree line; trees stand at different
 * distances, hazier the further they are. At the end of the path grows the
 * prefix tree: its trunk is "pr", its boughs spell the rest ("efix", "o" then
 * "duct", "totype", "ject"), and each whole word is a crown of leaves with a
 * name plate (prefix, product, prototype, project).
 *
 * Every cell holds an amount of ink; it is drawn with the character whose
 * measured coverage in the page's mono font is closest, so tone reads
 * smoothly. Leaves and near grass move in a slow wind that picks up around
 * the pointer; a few birds cross the sky.
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

/** how much of a thing's tone survives the haze, by distance band (far .. near) */
const HAZE_TONE = [0.5, 0.66, 0.84, 1];

const NONE = 0;
const LEAF = 1; // rustles
const BLADE = 2; // near grass, sways

type Label = { text: string; x: number; y: number; strong: boolean };

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
  labels: Label[];
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
    labels: [],
  };
  const mobile = w < 640;
  const rand = mulberry32(23);

  // camera: standing on the path, looking a little down the garden
  const cx = w / 2;
  const yh = h * (mobile ? 0.34 : 0.37); // horizon
  const f = h * 0.9; // focal length, px
  const camH = 1.7; // eye height, m
  const toScreen = (x: number, z: number) => ({ x: cx + (x * f) / z, y: yh + (camH * f) / z, s: f / z });

  // the prefix tree stands at the end of the path
  const visibleBottom = groundTop ?? h;
  const treeBaseY = mobile ? Math.min(h * 0.6, visibleBottom - h * 0.16) : h * 0.57;
  const treeZ = (camH * f) / (treeBaseY - yh);
  const S = Math.min(treeBaseY - (mobile ? 190 : 175), (w * 0.92) / 1.45); // tree size, px
  const plazaR = 2.2;
  const pathHalf = 0.55;

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
  const blob = (bx: number, by: number, rx: number, ry: number, seed: number, tex: number, fog: number, weight = 1) => {
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
      ink(i, j, (val * far + 0.3 * (1 - far)) * far * weight, fog, LEAF, seed * 0.7 + fbm(i * 0.2, j * 0.2, 5) * 3);
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
    if (z > 16) return; // far away, a shadow is too thin to see and only piles up on one line
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
      sc.lum[k] = Math.min(1, sc.lum[k] + add);
    });
  };

  // ---------- sky: a few soft clouds, then the far tree line ----------
  cellsIn(0, 0, w, yh, (i, j, x, y) => {
    const c = fbm(x / 260, y / 70, 50);
    const v = Math.max(0, c - 0.58) * 0.9 * Math.min(1, (yh - y) / 60);
    if (v > 0.015) ink(i, j, v, 0);
  });
  cellsIn(0, yh - 70, w, yh, (i, j, x, y) => {
    const top = yh - (8 + 26 * fbm(x / 80, 0.5, 60) ** 1.4 + 12 * fbm(x / 22, 1.5, 61));
    if (y < top) return;
    const v = 0.24 + 0.3 * (fbm(x / 9, y / 9, 62) - 0.5) + 0.18 * ((y - top) / (yh - top));
    ink(i, j, v, 0, LEAF, hash(i, j, 63) * 6);
  });

  // ---------- the ground: lawn in mown stripes, a gravel path, a plaza ----------
  cellsIn(0, yh + 1, w, h, (i, j, sx, sy) => {
    if (sy <= yh + 1) return; // the row straddling the horizon belongs to the tree line
    const z = (camH * f) / (sy - yh);
    const x = ((sx - cx) * z) / f;
    const fog = fogAt(z);
    const detail = Math.min(1, 4 / z);
    const dz = z - treeZ;
    const pr = Math.sqrt(x * x + dz * dz);
    if (pr < plazaR) {
      ink(i, j, 0.05 + 0.1 * hash(i, j, 70) * detail, fog);
      return;
    }
    if (pr < plazaR + 0.12) {
      ink(i, j, 0, fog);
      const side = Math.abs(x) > plazaR * 0.85;
      mark(i, j, side ? (x < 0 ? "(" : ")") : dz < 0 ? "_" : "-", fog);
      return;
    }
    if (Math.abs(x) < pathHalf && z < treeZ) {
      ink(i, j, 0.05 + 0.12 * hash(i, j, 71) * detail, fog);
      return;
    }
    if (Math.abs(x) < pathHalf + 0.07 && z < treeZ) {
      ink(i, j, 0, fog);
      mark(i, j, x < 0 ? "/" : "\\", fog);
      return;
    }
    const stripe = Math.floor((x + 100) / 1.6) % 2 ? 0.07 : -0.03;
    const grass = 0.24 + stripe + 0.14 * (fbm(x * 0.9, z * 0.9, 1) - 0.5) + 0.22 * (hash(i, j, 72) - 0.5) * detail;
    const haze = Math.min(1, z / 45);
    ink(i, j, grass * (1 - haze) + 0.1 * haze, fog, z < 7 ? BLADE : NONE, hash(i, j, 73) * 6.28);
  });

  // ---------- things standing in the garden, drawn far to near ----------
  type Thing = { z: number; draw: () => void };
  const things: Thing[] = [];

  const roundTree = (x: number, z: number, height: number, seed: number) => {
    const p = toScreen(x, z);
    const fog = fogAt(z);
    const crownR = height * 0.36 * p.s;
    const trunk = height * 0.42 * p.s;
    shadow(p.x + crownR * 0.35, p.y, crownR * 1.1, Math.max(ch, crownR * 0.22), 0.25, z);
    limb({ x: p.x, y: p.y }, { x: p.x, y: p.y - trunk * 0.5 }, { x: p.x, y: p.y - trunk - crownR * 0.3 }, crownR * 0.1, crownR * 0.06, fog);
    crown(p.x, p.y - trunk - crownR * 0.55, crownR * 1.05, crownR * 0.85, seed, Math.max(3, p.s * 0.45), fog);
  };
  const conifer = (x: number, z: number, height: number, seed: number) => {
    const p = toScreen(x, z);
    const fog = fogAt(z);
    const ht = height * p.s;
    const wd = ht * 0.3;
    shadow(p.x + wd * 0.4, p.y, wd * 1.2, Math.max(ch, wd * 0.25), 0.25, z);
    limb({ x: p.x, y: p.y }, { x: p.x, y: p.y - ht * 0.06 }, { x: p.x, y: p.y - ht * 0.14 }, wd * 0.07, wd * 0.06, fog);
    const top = p.y - ht;
    cellsIn(p.x - wd, top, p.x + wd, p.y - ht * 0.1, (i, j, sx, sy) => {
      const yr = (sy - top) / (ht * 0.9);
      const half = wd * yr * (0.72 + 0.28 * ((yr * 5) % 1));
      const dx = sx - p.x;
      if (Math.abs(dx) > half) return;
      const v = HAZE_TONE[fog] * 0.42 + (dx / (half || 1)) * 0.22 * HAZE_TONE[fog] + yr * 0.12 + 0.4 * (fbm(sx / Math.max(3, p.s * 0.3), sy / Math.max(3, p.s * 0.3), seed) - 0.5);
      ink(i, j, v, fog, LEAF, seed + i * 0.2);
    });
  };
  const flowers = (x: number, z: number, seed: number) => {
    const p = toScreen(x, z);
    const fog = fogAt(z);
    const rx = 0.36 * p.s;
    const ry = 0.26 * p.s;
    shadow(p.x + rx * 0.3, p.y, rx * 1.1, Math.max(ch * 0.6, ry * 0.4), 0.2, z);
    blob(p.x, p.y - ry * 0.8, rx, ry, seed, Math.max(2.5, p.s * 0.12), fog, 0.68);
    const r = mulberry32(seed);
    const big = 0.09 * p.s > ch * 0.5;
    for (let k = 0; k < 6; k++) {
      const fx = p.x + (r() - 0.5) * rx * 1.5;
      const fy = p.y - ry * 0.8 - r() * ry * 0.9;
      const i = Math.floor(fx / cw);
      const j = Math.floor(fy / ch);
      if (i < 0 || i >= cols || j < 0 || j >= rows) continue;
      if (big) mark(i, j, ["o", "@", "*"][Math.floor(r() * 3)], fog);
      else ink(i, j, 0.04, fog);
    }
  };

  // flower beds along both sides of the path
  const zNear = (camH * f) / (h - yh);
  for (let z = zNear + 0.2; z < treeZ - plazaR - 0.3; z += 0.42) {
    for (const side of [-1, 1]) things.push({ z, draw: () => flowers(side * (pathHalf + 0.42 + rand() * 0.08), z, Math.floor(rand() * 999)) });
  }
  // the garden's other trees: framing the view near us, around the plaza, and far away
  const placeTree = (x: number, z: number, height: number) => {
    const seed = Math.floor(rand() * 999);
    const kind = rand() < 0.3 ? conifer : roundTree;
    things.push({ z, draw: () => kind(x, z, height, seed) });
  };
  for (let k = 0; k < 6; k++) {
    const side = k % 2 ? 1 : -1;
    placeTree(side * (3.6 + rand() * 5), treeZ + 2 + rand() * 9, 3 + rand() * 1.8);
  }
  for (let k = 0; k < 11; k++) {
    const x = (rand() - 0.5) * 50;
    const z = 16 + rand() * 30;
    const p = toScreen(x, z);
    if (Math.abs(p.x - cx) < S * 0.6) continue; // keep the prefix tree's crowns against the sky
    placeTree(x, z, 3.5 + rand() * 3);
  }
  // bushes on the lawns
  for (let k = 0; k < 10; k++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (1.8 + rand() * 4);
    const z = zNear + 2.5 + rand() * (treeZ + 5 - zNear);
    const seed = Math.floor(rand() * 999);
    things.push({
      z,
      draw: () => {
        const p = toScreen(x, z);
        const r = (0.3 + (seed % 5) * 0.05) * p.s;
        shadow(p.x + r * 0.3, p.y, r * 1.2, Math.max(ch * 0.6, r * 0.3), 0.22, z);
        crown(p.x, p.y - r * 0.6, r * 1.2, r * 0.75, seed, Math.max(2.5, p.s * 0.2), fogAt(z), 4);
      },
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
      limb(B, at(-0.04, 0.18), pr, S * 0.055, S * 0.04, fog);
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
      const family = getComputedStyle(canvas).fontFamily || "monospace";
      const font = `${size}px ${family}`;
      labelFont = `${mobile ? 11 : 13}px ${family}`;
      edgeFont = `${mobile ? 10 : 11}px ${family}`;
      ctx.font = font;
      const cw = Math.max(4, ctx.measureText("M").width);
      const ch = Math.round(size * 1.15);

      ink = measureInk(font, cw, ch);

      // every character at every haze level, drawn once
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
      FOG_ALPHA.forEach((al, r) => {
        a.fillStyle = `rgba(23, 23, 23, ${al})`;
        ink!.chars.forEach((c, k) => a.fillText(c, (k * cwD) / dpr + cw / 2, (r * chD) / dpr + ch / 2));
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
              if (an === LEAF) v += Math.sin(sc.phase[k] + t * (1.3 + gust * 7)) * (0.04 + wind * 0.05 + gust * 0.2);
              else v += Math.sin(sc.phase[k] + t * (1.5 + gust * 6) + wind * 2) * (0.06 + gust * 0.15);
            }
            v = 0.9 * Math.max(0, v) ** 1.6; // paper should dominate
            if (v < 0.02) continue;
            ci = ink.lut[Math.min(63, Math.round(v * 63))];
          }
          if (ci === 0 && !g) continue;
          ctx.drawImage(atlas, ci * cwD, sc.fog[k] * chD, cwD, chD, Math.round(i * sc.cw * dpr), Math.round(j * sc.ch * dpr), cwD, chD);
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

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
        const tw = ctx.measureText(l.text).width;
        const ph = l.strong ? 18 : 15;
        ctx.fillStyle = l.strong ? "rgba(247, 244, 234, 0.92)" : "rgba(247, 244, 234, 0.75)";
        ctx.fillRect(l.x - tw / 2 - 5, l.y - ph / 2, tw + 10, ph);
        ctx.fillStyle = l.strong ? "rgba(23, 23, 23, 1)" : "rgba(23, 23, 23, 0.55)";
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
