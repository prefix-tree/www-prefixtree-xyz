"use client";

import { useEffect, useRef } from "react";

/*
 * A pine forest in the morning, after Shishkin ("Morning in a Pine Forest"),
 * in black ASCII on white, like an etching.
 *
 * Made in two steps. First a forest is painted on a hidden canvas: rows of
 * pine trunks fading into mist, a ragged canopy overhead, light falling in
 * from the back right, a broken pine fallen across the foreground, great
 * trunks framing the view, ferns. Then the painting is read as characters:
 * where it has an edge (a trunk's side, the log's slope) the edge's direction
 * is drawn with | / \ -, and elsewhere each cell gets the symbol whose
 * measured ink in the page's mono font matches its tone.
 *
 * Light shafts breathe, mist drifts along the floor and motes float in the
 * light; the pointer is a patch of sun. Four trees carry the names of the
 * prefix tree's words: prefix, product, prototype, project.
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

// ---------- the painting: a pine forest at morning, after Shishkin ----------

type Label = { text: string; x: number; y: number };

type Painting = {
  /** ink per pixel of the hidden canvas, 0 paper .. 1 black */
  ink: Float32Array;
  W: number;
  H: number;
  labels: Label[];
  /** where the floor of the far forest meets the trunks, css px */
  floor: number;
  /** where the light comes from, css px */
  sun: { x: number; y: number };
};

function paintForest(w: number, h: number, ground: number): Painting {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.scale(W / w, H / h);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);

  const rand = mulberry32(19);
  const mobile = w < 640;
  const k = Math.max(0.5, Math.min(1.3, w / 1440)); // trunk widths follow the screen
  const floor = ground * 0.63;
  const sun = { x: w * 0.68, y: -h * 0.12 };
  const grey = (ink: number) => {
    const v = Math.round(255 * (1 - Math.max(0, Math.min(1, ink))));
    return `rgb(${v},${v},${v})`;
  };
  const labels: Label[] = [];

  /** a pine trunk: tapering, lit on the right, bark streaks up close, a few dead branch stubs */
  const trunk = (x: number, base: number, width: number, ink: number, bark: boolean) => {
    const top = -h * 0.05;
    const lean = (rand() - 0.5) * width * 0.8;
    g.beginPath();
    g.moveTo(x - width / 2, base);
    g.lineTo(x - width * 0.36 + lean, top);
    g.lineTo(x + width * 0.36 + lean, top);
    g.lineTo(x + width / 2, base);
    g.closePath();
    const sh = g.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
    sh.addColorStop(0, grey(ink));
    sh.addColorStop(0.5, grey(ink * 0.9));
    sh.addColorStop(0.78, grey(ink * 0.5));
    sh.addColorStop(1, grey(ink * 0.75));
    g.fillStyle = sh;
    g.fill();
    // root flare
    g.beginPath();
    g.moveTo(x - width * 0.9, base + width * 0.08);
    g.quadraticCurveTo(x - width * 0.45, base - width * 0.3, x - width * 0.35, base - width * 0.9);
    g.lineTo(x + width * 0.35, base - width * 0.9);
    g.quadraticCurveTo(x + width * 0.45, base - width * 0.3, x + width * 0.9, base + width * 0.08);
    g.closePath();
    g.fillStyle = grey(ink * 0.95);
    g.fill();
    if (bark) {
      g.strokeStyle = grey(Math.min(1, ink * 1.15));
      for (let s = 0; s < width / 8; s++) {
        const off = (rand() - 0.5) * width * 0.8;
        let y = base;
        g.lineWidth = 0.6 + rand() * 1.2;
        g.beginPath();
        g.moveTo(x + off, y);
        while (y > top) {
          y -= 8 + rand() * 30;
          const t = (base - y) / (base - top);
          g.lineTo(x + off * (1 - t * 0.3) + lean * t + (rand() - 0.5) * 2, y);
        }
        g.stroke();
      }
      // the lower bark breaks into plates
      g.lineWidth = 1;
      for (let s = 0; s < width * 0.6; s++) {
        const y = base - rand() * (base - top) * 0.5;
        const x0 = x + (rand() - 0.5) * width * 0.7;
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x0 + width * (0.06 + rand() * 0.1), y + (rand() - 0.5) * 3);
        g.stroke();
      }
    }
    // dead branch stubs, angled down
    g.strokeStyle = grey(ink);
    for (let s = 0; s < 2 + rand() * 3; s++) {
      const y = base - (0.35 + rand() * 0.6) * (base - top);
      const side = rand() < 0.5 ? -1 : 1;
      const t = (base - y) / (base - top);
      const x0 = x + lean * t + side * width * 0.38 * (1 - t * 0.3);
      const len = width * (0.4 + rand() * 0.9);
      g.lineWidth = Math.max(0.6, width * 0.045);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + side * len, y + len * (0.25 + rand() * 0.35));
      g.stroke();
    }
  };

  /** needles high up: tufts of short strokes hanging from the branches, thinning downward */
  const canopy = (ink: number, depth: number, count: number) => {
    for (let s = 0; s < count; s++) {
      const x = rand() * w;
      const y = -h * 0.03 + rand() ** 2.2 * h * (0.1 + depth * 0.05);
      const rx = (24 + rand() * 50) * k * (0.6 + depth * 0.45);
      // the branch the tuft hangs from
      g.strokeStyle = grey(ink);
      g.lineWidth = Math.max(0.6, rx * 0.04);
      g.beginPath();
      g.moveTo(x - rx, y + rx * 0.08);
      g.quadraticCurveTo(x, y - rx * 0.1, x + rx, y + rx * 0.12);
      g.stroke();
      // needles: short strokes, drooping, denser in the middle of the tuft
      g.lineWidth = Math.max(0.5, 0.6 + depth * 0.25);
      for (let q = 0; q < 60 + depth * 20; q++) {
        const u = (rand() - 0.5) * 2;
        const px = x + u * rx;
        const py = y + (rand() - 0.3) * rx * 0.35 * (1 - Math.abs(u) * 0.5);
        const a = Math.PI / 2 + (rand() - 0.5) * 1.6;
        const len = rx * (0.08 + rand() * 0.12);
        g.strokeStyle = grey(ink * (0.6 + rand() * 0.5));
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
        g.stroke();
      }
    }
  };

  /** the white of distance and morning mist laid over everything behind */
  const veil = (alpha: number) => {
    const m = g.createLinearGradient(0, 0, 0, h);
    m.addColorStop(0, `rgba(255,255,255,${alpha * 0.5})`);
    m.addColorStop(floor / h - 0.08, `rgba(255,255,255,${alpha})`);
    m.addColorStop(Math.min(1, floor / h + 0.06), `rgba(255,255,255,${alpha * 1.1})`);
    m.addColorStop(1, `rgba(255,255,255,${alpha * 0.3})`);
    g.fillStyle = m;
    g.fillRect(0, 0, w, h);
  };

  // the forest floor, darker toward us, with patches of moss and shade
  const fl = g.createLinearGradient(0, floor, 0, h);
  fl.addColorStop(0, grey(0.12));
  fl.addColorStop(1, grey(0.5));
  g.fillStyle = fl;
  g.fillRect(0, floor, w, h - floor);
  for (let s = 0; s < 220; s++) {
    const y = floor + rand() ** 0.7 * (h - floor);
    const t = (y - floor) / (h - floor);
    g.beginPath();
    g.ellipse(rand() * w, y, (20 + rand() * 90) * (0.3 + t), (3 + rand() * 8) * (0.3 + t), 0, 0, Math.PI * 2);
    g.fillStyle = grey(0.1 + t * 0.5 + (rand() - 0.5) * 0.2);
    g.fill();
  }

  // trunks, far to near, each row behind a little more mist
  const rows = [
    { n: mobile ? 22 : 54, ink: 0.3, wid: [2, 5], base: 0.0 },
    { n: mobile ? 14 : 34, ink: 0.42, wid: [5, 10], base: 0.035 },
    { n: mobile ? 9 : 20, ink: 0.55, wid: [10, 18], base: 0.085 },
    { n: mobile ? 5 : 11, ink: 0.7, wid: [18, 32], base: 0.16 },
  ];
  const named = ["prefix", "product", "prototype", "project"];
  const namedAt = mobile ? [0.3, 0.46, 0.62, 0.78] : [0.36, 0.47, 0.6, 0.71];
  rows.forEach((r, d) => {
    canopy(r.ink * 0.9, d, mobile ? 10 + d * 4 : 26 + d * 8);
    const xs: number[] = [];
    for (let s = 0; s < r.n; s++) {
      // leave a gap around the light, as in the painting
      let x = rand() * w;
      if (d >= 2 && Math.abs(x - sun.x * 0.92) < w * 0.07) x += w * 0.14;
      xs.push(x);
    }
    if (d === 2) xs.push(...namedAt.map((u) => u * w));
    xs.forEach((x, s) => {
      const base = floor + ground * r.base + rand() * ground * 0.02;
      const width = (r.wid[0] + rand() * (r.wid[1] - r.wid[0])) * k;
      trunk(x, base, width, r.ink, d >= 2);
      if (d === 2 && s >= r.n) labels.push({ text: named[s - r.n], x, y: floor - ground * (0.14 + 0.05 * ((s - r.n) % 2)) });
    });
    veil(d === 3 ? 0.12 : 0.3);
  });

  // light pouring in from the back, right of centre
  const glow = g.createRadialGradient(sun.x * 0.92, floor - ground * 0.12, 0, sun.x * 0.92, floor - ground * 0.12, Math.max(w, h) * 0.38);
  glow.addColorStop(0, "rgba(255,255,255,0.75)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  // shafts of light slanting down through the trunks
  for (let q = 0; q < 9; q++) {
    const a = Math.PI * (0.56 + rand() * 0.22);
    const spread = 0.012 + rand() * 0.03;
    const len = Math.hypot(w, h) * 1.2;
    g.beginPath();
    g.moveTo(sun.x, sun.y);
    g.lineTo(sun.x + Math.cos(a - spread) * len, sun.y + Math.sin(a - spread) * len);
    g.lineTo(sun.x + Math.cos(a + spread) * len, sun.y + Math.sin(a + spread) * len);
    g.closePath();
    const sh = g.createLinearGradient(0, 0, 0, ground);
    sh.addColorStop(0, "rgba(255,255,255,0)");
    sh.addColorStop(0.35, `rgba(255,255,255,${0.25 + rand() * 0.25})`);
    sh.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sh;
    g.fill();
  }

  // the broken pine, fallen across the foreground, its stump splintered
  const A = { x: w * (mobile ? -0.05 : 0.12), y: ground * 0.9 };
  const B = { x: w * (mobile ? 0.62 : 0.58), y: ground * 0.77 };
  const thick = ground * (mobile ? 0.03 : 0.042);
  const nx = -(B.y - A.y);
  const ny = B.x - A.x;
  const nl = Math.hypot(nx, ny);
  const ux = (nx / nl) * thick;
  const uy = (ny / nl) * thick;
  g.beginPath();
  g.moveTo(A.x + ux, A.y + uy);
  g.lineTo(B.x + ux * 0.8, B.y + uy * 0.8);
  g.lineTo(B.x - ux * 0.8, B.y - uy * 0.8);
  g.lineTo(A.x - ux, A.y - uy);
  g.closePath();
  const lg = g.createLinearGradient(A.x - ux, A.y - uy, A.x + ux, A.y + uy);
  lg.addColorStop(0, grey(0.35));
  lg.addColorStop(0.5, grey(0.62));
  lg.addColorStop(1, grey(0.85));
  g.fillStyle = lg;
  g.fill();
  g.strokeStyle = grey(0.9);
  for (let s = 0; s < 6; s++) {
    // bark lines along the log, and branches broken off it
    const t = rand();
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(A.x + (B.x - A.x) * t - ux * 0.6, A.y + (B.y - A.y) * t - uy * 0.6);
    g.lineTo(A.x + (B.x - A.x) * (t + 0.2) - ux * 0.5, A.y + (B.y - A.y) * (t + 0.2) - uy * 0.5);
    g.stroke();
    const bt = 0.15 + rand() * 0.75;
    const bx = A.x + (B.x - A.x) * bt;
    const by = A.y + (B.y - A.y) * bt - thick * 0.8;
    g.lineWidth = Math.max(1, thick * 0.1);
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + (rand() - 0.3) * thick * 1.4, by - thick * (0.6 + rand() * 1.2));
    g.stroke();
  }
  // the stump it broke from: splintered, the long shards leaning toward the log
  const sx = B.x + thick * 1.5;
  const sw = thick * 1.5;
  const sBase = B.y + thick * 0.6;
  const sTop = B.y - ground * 0.08;
  g.beginPath();
  g.moveTo(sx - sw, sBase);
  g.lineTo(sx - sw * 0.85, sTop + ground * 0.02);
  const shards = 9;
  for (let q = 0; q <= shards; q++) {
    const x = sx - sw * 0.85 + (sw * 1.7 * q) / shards;
    const tall = q === 2 ? ground * 0.07 : q === 3 ? ground * 0.045 : rand() * ground * 0.025;
    g.lineTo(x - sw * 0.05, sTop - tall);
    g.lineTo(x + sw * 0.06, sTop + rand() * ground * 0.015);
  }
  g.lineTo(sx + sw, sBase);
  g.closePath();
  const sg = g.createLinearGradient(sx - sw, 0, sx + sw, 0);
  sg.addColorStop(0, grey(0.85));
  sg.addColorStop(0.65, grey(0.48));
  sg.addColorStop(1, grey(0.68));
  g.fillStyle = sg;
  g.fill();
  g.strokeStyle = grey(0.95);
  g.lineWidth = 1;
  for (let q = 0; q < 7; q++) {
    const x = sx - sw * 0.7 + rand() * sw * 1.4;
    g.beginPath();
    g.moveTo(x, sBase - thick * 0.3);
    g.lineTo(x + (rand() - 0.5) * 3, sTop + ground * 0.01);
    g.stroke();
  }

  // great trunks framing the view, close by
  trunk(w * (mobile ? 0.04 : 0.06), h * 1.02, w * (mobile ? 0.13 : 0.1), 0.88, true);
  if (!mobile) trunk(w * 0.955, h * 1.02, w * 0.055, 0.82, true);
  trunk(w * (mobile ? 0.92 : 0.84), ground * 0.97, (mobile ? 22 : 34) * k, 0.76, true);

  // ferns and grass up close
  for (let s = 0; s < (mobile ? 60 : 120); s++) {
    const y = ground * (0.8 + rand() * 0.25);
    const t = Math.min(1, (y - ground * 0.8) / (ground * 0.25));
    const x = rand() * w;
    const len = (10 + rand() * 30) * (0.5 + t) * k * 1.4;
    g.strokeStyle = grey(0.45 + t * 0.4);
    g.lineWidth = 0.8 + t;
    for (let f = -3; f <= 3; f++) {
      const a = -Math.PI / 2 + f * 0.28 + (rand() - 0.5) * 0.2;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.7, x + Math.cos(a) * len, y + Math.sin(a) * len * 0.6 + len * 0.15);
      g.stroke();
    }
  }

  const data = g.getImageData(0, 0, W, H).data;
  const ink = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) ink[p] = 1 - data[p * 4] / 255;
  return { ink, W, H, labels, floor, sun };
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
  /** how much a light shaft crosses this cell, 0..1 */
  shaft: Float32Array;
  /** how much morning mist lies here, 0..1 */
  mist: Float32Array;
  clear: Uint8Array;
  labels: Label[];
};

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

  // light shafts fan down from the sun; mist lies along the far floor
  const shaft = new Float32Array(n);
  const mist = new Float32Array(n);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cw;
      const y = (j + 0.5) * ch;
      const a = Math.atan2(y - p.sun.y, x - p.sun.x);
      const band = Math.max(0, Math.min(1, (valueNoise(a * 34, 3.3, 90) - 0.52) * 4));
      const fade = Math.max(0, 1 - Math.abs(y / p.floor - 0.62) * 1.4);
      shaft[j * cols + i] = band * fade;
      mist[j * cols + i] = Math.exp(-(((y - p.floor) / (h * 0.08)) ** 2));
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

  return { cols, rows, cw, ch, w, h, tone, edge, shaft, mist, clear, labels: p.labels };
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
    let dpr = 1;
    let labelFont = "";
    let moteFont = "";
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
      const size = mobile ? 7 : 8;
      const family = getComputedStyle(canvas).fontFamily || "monospace";
      const font = `300 ${size}px ${family}`; // thin strokes, like an etching needle
      labelFont = `${mobile ? 11 : 13}px ${family}`;
      moteFont = `${mobile ? 9 : 11}px ${family}`;
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
      draw(performance.now());
    };

    const draw = (now: number) => {
      const c = cells;
      if (!c || !ink || !atlas) return;
      const t = reduced ? 0 : now / 1000;
      const cwD = Math.ceil(c.cw * dpr);
      const chD = Math.ceil(c.ch * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const pr = 90; // the pointer is a patch of sunlight on the forest
      for (let j = 0; j < c.rows; j++) {
        for (let i = 0; i < c.cols; i++) {
          const k = j * c.cols + i;
          if (c.clear[k]) continue;
          let v = c.tone[k];
          if (!reduced) {
            const s = c.shaft[k] * (0.7 + 0.3 * Math.sin(t * 0.35 + i * 0.02));
            v *= 1 - 0.6 * s;
            const m = c.mist[k] * (0.45 + 0.55 * valueNoise(i * 0.05 + t * 0.06, j * 0.14, 91));
            v *= 1 - 0.55 * m;
            if (pointer.energy > 0.01) {
              const d = Math.hypot((i + 0.5) * c.cw - pointer.x, (j + 0.5) * c.ch - pointer.y) / pr;
              if (d < 1) v *= 1 - 0.5 * (1 - d * d) * pointer.energy;
            }
          } else {
            v *= 1 - 0.6 * c.shaft[k];
            v *= 1 - 0.4 * c.mist[k];
          }
          v = 0.95 * v ** 1.3; // paper should dominate, as in an etching
          const e = c.edge[k];
          if (v < 0.03 && !e) continue;
          const ci = e ? (ink.index.get(e) ?? 0) : ink.lut[Math.min(63, Math.round(v * 63))];
          if (ci === 0) continue;
          ctx.drawImage(atlas, ci * cwD, 0, cwD, chD, Math.round(i * c.cw * dpr), Math.round(j * c.ch * dpr), cwD, chD);
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // motes of dust drifting in the light
      ctx.font = moteFont;
      ctx.fillStyle = `rgba(${INK}, 0.45)`;
      for (let m = 0; m < 26; m++) {
        const bx = hash(m, 1, 92) * c.w;
        const by = hash(m, 2, 92) * c.h * 0.7;
        const x = bx + Math.sin(t * 0.2 + m) * 18;
        const y = (by + t * (4 + hash(m, 3, 92) * 6)) % (c.h * 0.75);
        const i = Math.floor(x / c.cw);
        const j = Math.floor(y / c.ch);
        if (i < 0 || j < 0 || i >= c.cols || j >= c.rows || c.shaft[j * c.cols + i] < 0.3) continue;
        ctx.fillText("·", x, y);
      }

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
      pointer.energy *= 0.94;
      draw(now);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.energy = Math.min(1, pointer.energy + 0.2);
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
