"use client";

import { useEffect, useRef } from "react";

/*
 * A spruce forest in black on white, after Shishkin's forests and ASCII
 * game renderers: foliage as free needle strokes, everything else as a grid
 * of characters.
 *
 * The four big spruces (and a lighter middle row) are made of thousands of
 * short strokes that hang and lean outward along each tier, dense in the
 * tier's shaded underside and sparse on its lit side, so the tiers read. A
 * meadow of grass blades runs from short and pale at the horizon to long and
 * dense up close. Behind and under them, a hidden canvas is painted (pale
 * spruce silhouettes on the horizon, trunks, a cut stump with growth rings,
 * mushrooms, ferns) and read as characters: edges become | / \ - by their
 * direction (a structure tensor on the full painting), tone becomes the
 * symbol of matching measured ink.
 *
 * The characters are drawn once; the strokes sway in a slow wind. The four big
 * spruces carry the prefix tree's words: prefix, product, prototype, project.
 *
 * Elements inside the hero marked `data-garden-clear` get a clearing so their
 * text stays readable; a visible `data-garden-ground` element marks where the
 * forest stops being seen (on phones, the hero card).
 */

// ---------- deterministic noise ----------

function hash(x: number, y: number, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
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
/** characters drawn on purpose: the edges of things, motes of light */
const GLYPHS = "|/\\-_.'`·";

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

// ---------- the painting: a spruce forest, in clear outlined forms ----------

type Label = { text: string; x: number; y: number };

/** a needle or a grass blade: a short free stroke, not on the character grid */
type Stroke = { x: number; y: number; len: number; ang: number; alpha: number; sway: number; grass?: boolean };

type Painting = {
  /** ink per pixel of the hidden canvas (trunks, stump, mushrooms, ferns), 0 paper .. 1 black */
  ink: Float32Array;
  W: number;
  H: number;
  labels: Label[];
  /** foliage and grass, drawn as strokes over the characters */
  strokes: Stroke[];
};

function paintForest(w: number, h: number, ground: number): Painting {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);

  const rand = mulberry32(31);
  const mobile = w < 640;
  const grey = (ink: number) => {
    const v = Math.round(255 * (1 - Math.max(0, Math.min(1, ink))));
    return `rgb(${v},${v},${v})`;
  };
  const horizon = ground * 0.72;
  const line = Math.max(1.4, Math.min(w, h) / 420); // outline weight
  const labels: Label[] = [];
  const strokes: Stroke[] = [];
  g.lineJoin = "round";
  g.lineCap = "round";

  /**
   * a spruce: a trunk for the character grid, and tiers of branches made of
   * needle strokes that droop outward, dense in each tier's shaded underside
   * and sparse on its lit upper side and on the right
   */
  const spruce = (x: number, base: number, height: number, strength: number, trunk: boolean) => {
    const width = height * 0.42;
    const trunkH = height * 0.1;
    if (trunk) {
      // the trunk runs up under the branches: the character grid shows it between needles
      const tw = Math.max(3, width * 0.07);
      const tg = g.createLinearGradient(x - tw, 0, x + tw, 0);
      tg.addColorStop(0, grey(0.9 * strength));
      tg.addColorStop(1, grey(0.55 * strength));
      g.fillStyle = tg;
      g.beginPath();
      g.moveTo(x - tw, base);
      g.lineTo(x - tw * 0.3, base - height * 0.85);
      g.lineTo(x + tw * 0.3, base - height * 0.85);
      g.lineTo(x + tw, base);
      g.closePath();
      g.fill();
    }
    const tiers = 7 + Math.floor(rand() * 3);
    const top = base - height;
    const step = Math.max(2.2, height / 190); // spacing between needles
    const len0 = Math.max(3.5, height / 42);
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers; // 0 bottom .. 1 top
      const yb = base - trunkH - f * (height - trunkH) * 0.92; // the tier's lower edge
      const hw = (width / 2) * (1 - f) ** 0.85 + width * 0.03;
      const th = ((height - trunkH) / tiers) * 1.9;
      const apex = Math.max(top, yb - th);
      const path = new Path2D();
      path.moveTo(x, apex);
      path.quadraticCurveTo(x - hw * 0.45, yb - th * 0.45, x - hw, yb + th * 0.12);
      const teeth = Math.max(4, Math.round(hw / (height * 0.025)));
      for (let q = 1; q <= teeth; q++) {
        const px = x - hw + (2 * hw * q) / teeth;
        const sag = th * 0.1 * Math.sin((Math.PI * q) / teeth);
        path.lineTo(px - hw / teeth, yb - th * 0.08 + sag);
        path.lineTo(px, yb + th * (0.1 + rand() * 0.08) + sag);
      }
      path.quadraticCurveTo(x + hw * 0.45, yb - th * 0.45, x, apex);
      path.closePath();
      for (let py = apex; py < yb + th * 0.3; py += step) {
        for (let px = x - hw; px < x + hw; px += step) {
          const sx = px + (rand() - 0.5) * step;
          const sy = py + (rand() - 0.5) * step;
          if (!g.isPointInPath(path, sx, sy)) continue;
          const v = Math.min(1, Math.max(0, (sy - apex) / (yb - apex))); // 0 top of tier .. 1 its lower edge
          const u = (sx - x) / hw; // -1 left .. 1 right
          const dense = (0.22 + 0.78 * v * v) * (1 - 0.4 * Math.max(0, u));
          if (rand() > dense) continue;
          strokes.push({
            x: sx,
            y: sy,
            len: len0 * (0.6 + rand() * 0.7) * (0.7 + 0.5 * v),
            ang: Math.PI / 2 - u * 0.75 + (rand() - 0.5) * 0.55, // hanging, leaning outward
            alpha: strength * (0.35 + 0.65 * dense),
            sway: 0.05 + 0.05 * strength,
          });
        }
      }
    }
    // the leader at the very top
    for (let q = 0; q < 4; q++) strokes.push({ x, y: top + q * len0 * 0.6, len: len0, ang: Math.PI / 2, alpha: strength, sway: 0.04 });
  };

  /** a fern: fronds arching out of one root, each with paired leaflets */
  const fern = (x: number, base: number, size: number) => {
    g.strokeStyle = grey(1);
    const fronds = 6;
    for (let f = 0; f < fronds; f++) {
      const a = -Math.PI / 2 + (f / (fronds - 1) - 0.5) * 2.3 + (rand() - 0.5) * 0.15;
      const len = size * (0.75 + rand() * 0.3) * (1 - Math.abs(f / (fronds - 1) - 0.5) * 0.4);
      const bend = (f / (fronds - 1) - 0.5) * 0.9 + 0.1;
      const pts: { x: number; y: number; nx: number; ny: number }[] = [];
      for (let s = 0; s <= 20; s++) {
        const t = s / 20;
        const ang = a + bend * t * t;
        const px = x + Math.cos(a) * len * t + Math.cos(ang) * len * 0.15 * t * t;
        const py = base + Math.sin(a) * len * t + Math.abs(bend) * len * 0.35 * t * t;
        pts.push({ x: px, y: py, nx: -Math.sin(ang), ny: Math.cos(ang) });
      }
      g.lineWidth = line;
      g.beginPath();
      pts.forEach((p, s) => (s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      g.lineWidth = Math.max(1, line * 0.8);
      for (let s = 2; s < 20; s += 1) {
        const p = pts[s];
        const t = s / 20;
        const leaf = size * 0.16 * Math.sin(Math.PI * (0.15 + t * 0.85)) * (1 - t * 0.3);
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x + side * p.nx * leaf + (pts[s + 1]?.x - p.x || 0) * 0.8, p.y + side * p.ny * leaf + (pts[s + 1]?.y - p.y || 0) * 0.8);
          g.stroke();
        }
      }
    }
  };

  /** a cut stump: bark sides, growth rings on top, roots */
  const stump = (x: number, base: number, width: number) => {
    const hgt = width * 0.7;
    const ry = width * 0.18;
    g.lineWidth = line;
    g.strokeStyle = grey(1);
    // roots
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + s * width * 0.45, base - hgt * 0.3);
      g.quadraticCurveTo(x + s * width * 0.6, base - hgt * 0.02, x + s * width * 0.85, base + ry * 0.4);
      g.lineTo(x + s * width * 0.5, base + ry * 0.4);
      g.closePath();
      g.fillStyle = grey(0.45);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.moveTo(x - width / 2, base - hgt);
    g.lineTo(x - width / 2, base);
    g.ellipse(x, base, width / 2, ry, 0, Math.PI, 0, true);
    g.lineTo(x + width / 2, base - hgt);
    g.closePath();
    const sh = g.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
    sh.addColorStop(0, grey(0.6));
    sh.addColorStop(1, grey(0.3));
    g.fillStyle = sh;
    g.fill();
    g.stroke();
    // bark furrows
    for (let s = 0; s < 6; s++) {
      const bx = x - width * 0.4 + (width * 0.8 * s) / 5;
      g.beginPath();
      g.moveTo(bx, base - hgt + ry * 0.9);
      g.lineTo(bx + (rand() - 0.5) * 3, base + ry * 0.6 * Math.sqrt(1 - ((bx - x) / (width / 2)) ** 2));
      g.stroke();
    }
    // the cut face and its rings
    g.beginPath();
    g.ellipse(x, base - hgt, width / 2, ry, 0, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    g.stroke();
    g.lineWidth = Math.max(1, line * 0.7);
    for (let r = 1; r <= 3; r++) {
      g.beginPath();
      g.ellipse(x + width * 0.03, base - hgt, (width / 2) * (r / 4), ry * (r / 4), 0, 0, Math.PI * 2);
      g.stroke();
    }
  };

  /** a mushroom: a dark rounded cap on a pale stem */
  const mushroom = (x: number, base: number, size: number, lean: number) => {
    const stemW = size * 0.32;
    const stemH = size * 0.8;
    const top = { x: x + lean * size * 0.2, y: base - stemH };
    g.lineWidth = line;
    g.strokeStyle = grey(1);
    g.beginPath();
    g.moveTo(x - stemW * 0.6, base);
    g.quadraticCurveTo(x - stemW * 0.7, base - stemH * 0.5, top.x - stemW * 0.4, top.y);
    g.lineTo(top.x + stemW * 0.4, top.y);
    g.quadraticCurveTo(x + stemW * 0.7, base - stemH * 0.5, x + stemW * 0.6, base);
    g.closePath();
    g.fillStyle = grey(0.08);
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(top.x, top.y + size * 0.02, size * 0.55, size * 0.42, lean * 0.2, Math.PI, 0);
    g.closePath();
    const cap = g.createLinearGradient(top.x - size * 0.5, 0, top.x + size * 0.5, 0);
    cap.addColorStop(0, grey(0.85));
    cap.addColorStop(1, grey(0.55));
    g.fillStyle = cap;
    g.fill();
    g.stroke();
  };

  /** a tuft of grass blades */
  const grass = (x: number, base: number, size: number, ink: number) => {
    g.strokeStyle = grey(ink);
    g.lineWidth = Math.max(1, line * 0.8);
    for (let b = 0; b < 5; b++) {
      const a = -Math.PI / 2 + (b / 4 - 0.5) * 1.1 + (rand() - 0.5) * 0.2;
      const len = size * (0.6 + rand() * 0.5);
      g.beginPath();
      g.moveTo(x, base);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.4, base + Math.sin(a) * len * 0.7, x + Math.cos(a) * len, base + Math.sin(a) * len);
      g.stroke();
    }
  };

  // the far forest: pale spruce silhouettes, left to the character grid
  for (let x = -20; x < w + 20; ) {
    const ht = ground * (0.1 + rand() * 0.14);
    const hw = ht * 0.2;
    const by = horizon + ground * 0.01;
    g.beginPath();
    g.moveTo(x, by - ht);
    for (let q = 1; q <= 6; q++) {
      const yy = by - ht + (ht * q) / 6;
      const ww = (hw * q) / 6;
      g.lineTo(x - ww, yy);
      g.lineTo(x - ww * 0.6, yy - ht * 0.03);
    }
    g.lineTo(x - hw, by);
    g.lineTo(x + hw, by);
    for (let q = 6; q >= 1; q--) {
      const yy = by - ht + (ht * q) / 6;
      const ww = (hw * q) / 6;
      g.lineTo(x + ww * 0.6, yy - ht * 0.03);
      g.lineTo(x + ww, yy);
    }
    g.closePath();
    g.fillStyle = grey(0.22 + rand() * 0.1);
    g.fill();
    x += ht * (0.18 + rand() * 0.14);
  }
  g.fillStyle = grey(0.22);
  g.fillRect(0, horizon + ground * 0.005, w, ground * 0.012);
  // the forest floor line, broken
  g.strokeStyle = grey(0.35);
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 6 + rand() * 30) {
    g.beginPath();
    g.moveTo(x, horizon + ground * 0.012);
    g.lineTo(x + 4 + rand() * 20, horizon + ground * 0.012);
    g.stroke();
  }
  // a middle row of spruces, lighter, outlined thinly
  const midXs = mobile ? [0.22, 0.55, 0.82] : [0.2, 0.38, 0.5, 0.66, 0.74, 0.93];
  for (const fx of midXs) spruce(fx * w + (rand() - 0.5) * 20, horizon + ground * 0.04, ground * (0.3 + rand() * 0.1), 0.5, true);

  // the four named spruces, standing apart, nearest the viewer
  const big = mobile
    ? [
        { fx: 0.1, base: 0.94, ht: 0.72, word: "prefix" },
        { fx: 0.38, base: 0.86, ht: 0.5, word: "product" },
        { fx: 0.68, base: 0.88, ht: 0.56, word: "prototype" },
        { fx: 0.93, base: 0.96, ht: 0.74, word: "project" },
      ]
    : [
        { fx: 0.09, base: 0.97, ht: 0.86, word: "prefix" },
        { fx: 0.29, base: 0.86, ht: 0.58, word: "product" },
        { fx: 0.69, base: 0.85, ht: 0.55, word: "prototype" },
        { fx: 0.87, base: 0.96, ht: 0.82, word: "project" },
      ];
  for (const b of big) {
    const x = b.fx * w;
    const base = b.base * ground;
    const ht = b.ht * ground;
    spruce(x, base, ht, 0.95, true);
    labels.push({ text: b.word, x, y: base - ht * 0.45 });
  }

  // the forest floor up close: a stump, mushrooms, ferns, grass
  const floorY = ground * (mobile ? 0.93 : 0.95);
  stump(w * (mobile ? 0.5 : 0.52), floorY, w * (mobile ? 0.16 : 0.075));
  const mx = w * (mobile ? 0.66 : 0.6);
  mushroom(mx, floorY + ground * 0.01, ground * 0.07, -0.4);
  mushroom(mx + ground * 0.06, floorY + ground * 0.02, ground * 0.05, 0.3);
  mushroom(mx - ground * 0.04, floorY + ground * 0.025, ground * 0.032, 0.1);
  fern(w * (mobile ? 0.25 : 0.42), floorY + ground * 0.04, ground * (mobile ? 0.16 : 0.2));
  if (!mobile) fern(w * 0.76, floorY + ground * 0.05, ground * 0.24);
  for (let s = 0; s < (mobile ? 10 : 22); s++) {
    const y = horizon + ground * 0.05 + rand() * ground * 0.25;
    grass(rand() * w, y, ground * 0.025 * (0.6 + (y - horizon) / ground * 3), 0.55 + (y - horizon) / ground);
  }
  // a meadow of blades: short and pale near the horizon, long and dense up close
  for (let y = horizon + 3; y < h; y += 4) {
    const t = Math.min(1, (y - horizon) / (ground - horizon));
    for (let x = rand() * 6; x < w; x += 5 / (0.35 + t)) {
      if (rand() > 0.25 + 0.45 * t) continue;
      strokes.push({
        x: x + (rand() - 0.5) * 4,
        y,
        len: (3 + (mobile ? 8 : 13) * t) * (0.6 + rand() * 0.6),
        ang: -Math.PI / 2 + (rand() - 0.5) * 0.9,
        alpha: 0.18 + 0.5 * t,
        sway: 0.08 + 0.1 * t,
        grass: true,
      });
    }
  }

  const data = g.getImageData(0, 0, W, H).data;
  const ink = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) ink[p] = 1 - data[p * 4] / 255;
  // grass stays clear of the stump, mushrooms and ferns, so they read
  const kept = strokes.filter((st) => {
    if (!st.grass) return true;
    const x = Math.round(st.x);
    const y = Math.round(st.y);
    for (let dy = -10; dy <= 4; dy += 7) {
      const yy = Math.min(H - 1, Math.max(0, y + dy));
      for (let dx = -6; dx <= 6; dx += 6) if (ink[yy * W + Math.min(W - 1, Math.max(0, x + dx))] > 0.35) return false;
    }
    return true;
  });
  return { ink, W, H, labels, strokes: kept };
}

// ---------- the painting, read as characters ----------

type Cells = {
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  w: number;
  h: number;
  /** tone per cell */
  tone: Float32Array;
  /** an edge character where the painting has an edge, else "" */
  edge: string[];
  clear: Uint8Array;
  labels: Label[];
  /** strokes as packed data, grouped by darkness: x, y, len, ang, sway per stroke */
  strokeBuckets: Float32Array[];
};

const STROKE_SHADES = 8;

function readCells(p: Painting, w: number, h: number, cw: number, ch: number, clearings: DOMRect[]): Cells {
  const cols = Math.ceil(w / cw);
  const rows = Math.ceil(h / ch);
  const n = cols * rows;
  const tone = new Float32Array(n);
  const edge: string[] = new Array(n).fill("");
  const sx = p.W / w;
  const sy = p.H / h;
  const ink = (x: number, y: number) => p.ink[Math.min(p.H - 1, Math.max(0, y)) * p.W + Math.min(p.W - 1, Math.max(0, x))];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x0 = Math.floor(i * cw * sx);
      const x1 = Math.min(p.W, Math.max(x0 + 1, Math.floor((i + 1) * cw * sx)));
      const y0 = Math.floor(j * ch * sy);
      const y1 = Math.min(p.H, Math.max(y0 + 1, Math.floor((j + 1) * ch * sy)));
      // tone, and the structure of the edges inside the cell (a structure tensor)
      let sum = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = p.ink[y * p.W + x];
          sum += v;
          const gx = (ink(x + 1, y) - ink(x - 1, y)) / 2;
          const gy = (ink(x, y + 1) - ink(x, y - 1)) / 2;
          sxx += gx * gx;
          syy += gy * gy;
          sxy += gx * gy;
          cnt++;
        }
      }
      const k = j * cols + i;
      tone[k] = cnt ? sum / cnt : 0;
      const energy = (sxx + syy) / (cnt || 1);
      if (energy < 0.008 || tone[k] > 0.62) continue; // real edges only, not the inside of dark trunks
      // how line-like the edges are, and which way the gradient runs
      const diff = Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy);
      const coherence = diff / (sxx + syy || 1);
      if (coherence < 0.55) continue;
      const theta = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI; // gradient angle, -90..90
      const a = Math.abs(theta);
      edge[k] = a < 22 ? "|" : a > 68 ? "-" : theta > 0 ? "\\" : "/";
    }
  }

  const clear = new Uint8Array(n);
  for (const r of clearings) {
    const pad = cw * 3;
    const mx = (r.left + r.right) / 2;
    const my = (r.top + r.bottom) / 2;
    const ax = r.width / 2 + pad;
    const ay = r.height / 2 + pad * 0.5;
    for (let j = Math.max(0, Math.floor((my - ay) / ch)); j <= Math.min(rows - 1, Math.ceil((my + ay) / ch)); j++) {
      for (let i = Math.max(0, Math.floor((mx - ax) / cw)); i <= Math.min(cols - 1, Math.ceil((mx + ax) / cw)); i++) {
        const d = Math.abs(((i + 0.5) * cw - mx) / ax) ** 4 + Math.abs(((j + 0.5) * ch - my) / ay) ** 4;
        if (d < 0.7 || (d < 1 && hash(i, j, 30) < 0.5)) clear[j * cols + i] = 1;
      }
    }
  }

  const groups: number[][] = Array.from({ length: STROKE_SHADES }, () => []);
  for (const st of p.strokes) {
    const i = Math.floor(st.x / cw);
    const j = Math.floor(st.y / ch);
    if (i >= 0 && j >= 0 && i < cols && j < rows && clear[j * cols + i]) continue;
    const b = Math.min(STROKE_SHADES - 1, Math.max(0, Math.floor(st.alpha * STROKE_SHADES)));
    groups[b].push(st.x, st.y, st.len, st.ang, st.sway);
  }
  const strokeBuckets = groups.map((g) => new Float32Array(g));

  return { cols, rows, cw, ch, w, h, tone, edge, clear, labels: p.labels, strokeBuckets };
}

// ---------- drawing ----------

const INK = "20, 20, 20";

export default function AsciiForest({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const host = canvas.parentElement!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cells: Cells | null = null;
    let ink: Ink | null = null;
    let atlas: HTMLCanvasElement | null = null;
    let still: HTMLCanvasElement | null = null; // the forest, drawn once
    let dpr = 1;
    let labelFont = "";
    let raf = 0;
    let last = 0;
    let visible = true;

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
      const size = mobile ? 7 : 8;
      const family = getComputedStyle(canvas).fontFamily || "monospace";
      const font = `300 ${size}px ${family}`; // thin strokes, like an etching needle
      labelFont = `${mobile ? 11 : 13}px ${family}`;
      ctx.font = font;
      const cw = Math.max(4, ctx.measureText("M").width);
      const ch = Math.round(size * 1.15);
      ink = measureInk(font, cw, ch);

      const cwD = Math.ceil(cw * dpr);
      const chD = Math.ceil(ch * dpr);
      atlas = document.createElement("canvas");
      atlas.width = cwD * ink.chars.length;
      atlas.height = chD;
      const a = atlas.getContext("2d")!;
      a.scale(dpr, dpr);
      a.font = font;
      a.textAlign = "center";
      a.textBaseline = "middle";
      a.fillStyle = `rgba(${INK}, 1)`;
      ink.chars.forEach((c, k) => a.fillText(c, (k * cwD) / dpr + cw / 2, ch / 2));

      const clearings = Array.from(host.querySelectorAll<HTMLElement>("[data-garden-clear]"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return new DOMRect(r.left - rect.left, r.top - rect.top, r.width, r.height);
        });
      const groundEl = host.querySelector<HTMLElement>("[data-garden-ground]");
      const ground =
        groundEl && groundEl.offsetParent !== null ? groundEl.getBoundingClientRect().bottom - rect.top : h;

      cells = readCells(paintForest(w, h, ground), w, h, cw, ch, clearings);
      still = drawStill(cells, ink, atlas);
      draw(performance.now());
    };

    const drawStill = (c: Cells, ink: Ink, atlas: HTMLCanvasElement) => {
      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      const o = out.getContext("2d")!;
      const cwD = Math.ceil(c.cw * dpr);
      const chD = Math.ceil(c.ch * dpr);
      for (let j = 0; j < c.rows; j++) {
        for (let i = 0; i < c.cols; i++) {
          const k = j * c.cols + i;
          if (c.clear[k]) continue;
          const v = 0.95 * c.tone[k] ** 1.3; // paper should dominate, as in an etching
          const e = c.edge[k];
          if (v < 0.03 && !e) continue;
          const ci = e ? (ink.index.get(e) ?? 0) : ink.lut[Math.min(63, Math.round(v * 63))];
          if (ci === 0) continue;
          o.drawImage(atlas, ci * cwD, 0, cwD, chD, Math.round(i * c.cw * dpr), Math.round(j * c.ch * dpr), cwD, chD);
        }
      }
      return out;
    };

    const draw = (now: number) => {
      const c = cells;
      if (!c || !still) return;
      const t = reduced ? 0 : now / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(still, 0, 0);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // needles and blades: free strokes, swaying in a slow wind
      ctx.lineCap = "round";
      ctx.lineWidth = c.w < 640 ? 0.8 : 1;
      c.strokeBuckets.forEach((d, b) => {
        if (!d.length) return;
        ctx.strokeStyle = `rgba(${INK}, ${((b + 1) / STROKE_SHADES).toFixed(3)})`;
        ctx.beginPath();
        for (let q = 0; q < d.length; q += 5) {
          const x = d[q];
          const y = d[q + 1];
          const len = d[q + 2];
          const a = d[q + 3] + (reduced ? 0 : d[q + 4] * Math.sin(t * 1.1 + x * 0.006 + y * 0.002));
          const dx = Math.cos(a) * len * 0.5;
          const dy = Math.sin(a) * len * 0.5;
          ctx.moveTo(x - dx, y - dy);
          ctx.lineTo(x + dx, y + dy);
        }
        ctx.stroke();
      });

      // names on four of the trees
      ctx.font = labelFont;
      for (const l of c.labels) {
        const tw = ctx.measureText(l.text).width;
        ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
        ctx.beginPath();
        ctx.roundRect(l.x - tw / 2 - 6, l.y - 9, tw + 12, 18, 9);
        ctx.fill();
        ctx.fillStyle = `rgba(${INK}, 0.95)`;
        ctx.fillText(l.text, l.x, l.y + 0.5);
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < 110) return; // ~9 fps: ASCII should tick, not glide
      last = now;
      draw(now);
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
    if (!reduced) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      io.disconnect();
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
