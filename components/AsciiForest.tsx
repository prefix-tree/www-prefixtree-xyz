"use client";

import { useEffect, useRef } from "react";

/*
 * A pine bonsai in black on white: needles as free strokes, the rest as a
 * grid of characters.
 *
 * One tree has the stage: an informal upright pine with an S-curved, tapering
 * trunk and surface roots, six branches alternating up the trunk (the lowest
 * and longest on the left) and an apex, each carrying a pad of foliage with a
 * domed top and a flat underside. Needles grow in small fanned tufts, open and
 * light on top, close and dark underneath. A shallow pot on two feet, moss on
 * the soil, a pale sun behind.
 *
 * Needles and moss are short strokes off the character grid and sway a little.
 * The trunk, branches, pot and sun are painted on a hidden canvas and read as
 * characters: edges become | / \ - by their direction (a structure tensor on
 * the full painting), tone becomes the symbol of matching measured ink. The
 * characters are drawn once.
 *
 * Elements inside the hero marked `data-garden-clear` get a clearing so their
 * text stays readable; a visible `data-garden-ground` element marks where the
 * picture stops being seen (on phones, the hero card).
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

// ---------- the painting: a pine bonsai ----------

type Label = { text: string; x: number; y: number };

/** a needle: a short free stroke, not on the character grid */
type Stroke = { x: number; y: number; len: number; ang: number; alpha: number; sway: number };

type Painting = {
  /** ink per pixel of the hidden canvas (trunk, branches, pot, sun), 0 paper .. 1 black */
  ink: Float32Array;
  W: number;
  H: number;
  labels: Label[];
  /** needles and moss, drawn as strokes over the characters */
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

  const rand = mulberry32(8);
  const mobile = w < 640;
  const grey = (ink: number) => {
    const v = Math.round(255 * (1 - Math.max(0, Math.min(1, ink))));
    return `rgb(${v},${v},${v})`;
  };
  const line = Math.max(1.4, Math.min(w, h) / 420);
  const strokes: Stroke[] = [];
  g.lineJoin = "round";
  g.lineCap = "round";

  // size and place: the tree has the stage to itself
  const y0 = ground * (mobile ? 0.94 : 0.93); // the pot stands here
  const S = mobile ? Math.min(w * 0.95, (y0 - 160) * 0.92) : Math.min(w * 0.5, (y0 - 170) * 0.9);
  const cx = w * (mobile ? 0.5 : 0.56);
  const potW = S * 0.72;
  const potH = S * 0.11;
  const soil = y0 - potH;

  // a pale sun behind the tree
  g.beginPath();
  g.arc(cx + S * 0.1, soil - S * 0.62, S * 0.36, 0, Math.PI * 2);
  g.fillStyle = grey(0.07);
  g.fill();

  // ---------- the pot: shallow, rectangular, on two feet ----------
  const px0 = cx - potW / 2;
  g.strokeStyle = grey(1);
  g.lineWidth = line;
  for (const fx of [0.14, 0.86]) {
    g.fillStyle = grey(0.5);
    g.fillRect(px0 + potW * fx - S * 0.03, y0 - S * 0.005, S * 0.06, S * 0.025);
    g.strokeRect(px0 + potW * fx - S * 0.03, y0 - S * 0.005, S * 0.06, S * 0.025);
  }
  g.beginPath();
  g.moveTo(px0, soil);
  g.lineTo(px0 + potW, soil);
  g.lineTo(px0 + potW - S * 0.035, y0);
  g.lineTo(px0 + S * 0.035, y0);
  g.closePath();
  const pg = g.createLinearGradient(px0, 0, px0 + potW, 0);
  pg.addColorStop(0, grey(0.42));
  pg.addColorStop(0.7, grey(0.3));
  pg.addColorStop(1, grey(0.18));
  g.fillStyle = pg;
  g.fill();
  g.stroke();
  // the rim
  g.fillStyle = grey(0.5);
  g.fillRect(px0 - S * 0.012, soil - S * 0.018, potW + S * 0.024, S * 0.022);
  g.strokeRect(px0 - S * 0.012, soil - S * 0.018, potW + S * 0.024, S * 0.022);
  // a soft shadow under it
  g.beginPath();
  g.ellipse(cx + S * 0.03, y0 + S * 0.03, potW * 0.62, S * 0.018, 0, 0, Math.PI * 2);
  g.fillStyle = grey(0.12);
  g.fill();

  // ---------- the trunk: an S-curve, tapering, with surface roots ----------
  const P = [
    { x: cx - S * 0.05, y: soil - S * 0.01 },
    { x: cx + S * 0.16, y: soil - S * 0.24 },
    { x: cx - S * 0.2, y: soil - S * 0.48 },
    { x: cx + S * 0.03, y: soil - S * 0.86 },
  ];
  const at = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * u * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t * t * t * P[3].x,
      y: u * u * u * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t * t * t * P[3].y,
    };
  };
  const w0 = S * 0.07;
  const w1 = S * 0.01;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let s = 0; s <= 40; s++) {
    const t = s / 40;
    const p = at(t);
    const q = at(Math.min(1, t + 0.01));
    const p0 = at(Math.max(0, t - 0.01));
    const l = Math.hypot(q.x - p0.x, q.y - p0.y) || 1;
    const nx = -(q.y - p0.y) / l;
    const ny = (q.x - p0.x) / l;
    const wd = w1 + (w0 - w1) * (1 - t) ** 1.3 + (t < 0.07 ? ((0.07 - t) / 0.07) ** 2 * S * 0.06 : 0);
    left.push({ x: p.x - nx * wd, y: p.y - ny * wd });
    right.push({ x: p.x + nx * wd, y: p.y + ny * wd });
  }
  // surface roots (nebari) spreading over the soil
  for (const [dx, len] of [
    [-1, 0.2],
    [1, 0.17],
    [-1, 0.1],
  ] as const) {
    g.beginPath();
    g.moveTo(P[0].x + dx * w0 * 0.6, soil - S * 0.03);
    g.quadraticCurveTo(P[0].x + dx * S * len * 0.5, soil - S * 0.005, P[0].x + dx * S * len, soil);
    g.lineTo(P[0].x + dx * w0 * 0.2, soil);
    g.closePath();
    g.fillStyle = grey(0.45);
    g.fill();
    g.strokeStyle = grey(1);
    g.lineWidth = line;
    g.stroke();
  }
  g.beginPath();
  left.forEach((p, s) => (s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  [...right].reverse().forEach((p) => g.lineTo(p.x, p.y));
  g.closePath();
  const tg = g.createLinearGradient(cx - S * 0.2, 0, cx + S * 0.2, 0);
  tg.addColorStop(0, grey(0.5));
  tg.addColorStop(1, grey(0.22));
  g.fillStyle = tg;
  g.fill();
  g.strokeStyle = grey(1);
  g.lineWidth = line;
  g.stroke();
  // bark: a few long fissures following the trunk
  g.lineWidth = Math.max(1, line * 0.7);
  g.strokeStyle = grey(0.85);
  for (const f of [-0.45, 0, 0.4]) {
    g.beginPath();
    for (let s = 2; s <= 34; s++) {
      const a = left[s];
      const b = right[s];
      const x = a.x + (b.x - a.x) * (0.5 + f * 0.5) + Math.sin(s * 1.3 + f * 5) * 1.5;
      const y = a.y + (b.y - a.y) * (0.5 + f * 0.5);
      if (s === 2) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  // ---------- branches and their pads of needles ----------
  const len0 = Math.max(3.2, S / 70); // needle length
  /** a pad: overlapping clouds with a domed top and a flat underside, filled with tufts of needles */
  const pad = (cx0: number, cy0: number, rx: number, ry: number, seed: number) => {
    const r = mulberry32(seed);
    const clouds = [
      { x: cx0 - rx * 0.45, y: cy0 + ry * 0.12, rx: rx * 0.6, ry: ry * 0.85 },
      { x: cx0 + rx * 0.05, y: cy0 - ry * 0.1, rx: rx * 0.62, ry: ry },
      { x: cx0 + rx * 0.5, y: cy0 + ry * 0.1, rx: rx * 0.55, ry: ry * 0.8 },
    ];
    const inside = (x: number, y: number) => {
      for (const k of clouds) {
        const u = (x - k.x) / k.rx;
        if (Math.abs(u) >= 1) continue;
        const s = Math.sqrt(1 - u * u);
        const top = k.y - k.ry * s * (1 + 0.12 * Math.sin(u * 7 + seed));
        const bottom = k.y + k.ry * 0.45 * s;
        if (y > top && y < bottom) return { v: (y - top) / (bottom - top), u: (x - cx0) / rx };
      }
      return null;
    };
    const step = len0 * 0.75;
    for (let y = cy0 - ry * 1.3; y < cy0 + ry * 0.6; y += step) {
      for (let x = cx0 - rx * 1.1; x < cx0 + rx * 1.1; x += step) {
        const tx = x + (r() - 0.5) * step;
        const ty = y + (r() - 0.5) * step;
        const hit = inside(tx, ty);
        if (!hit) continue;
        const { v, u } = hit;
        // the top is lit and open, the underside dark and close
        if (r() > 0.62 + 0.38 * v) continue;
        const shade = Math.min(1, 0.28 + 0.66 * v ** 1.2 + 0.1 * Math.max(0, -u));
        // a tuft: needles fanning up from one point
        const n = 4 + Math.floor(r() * 3);
        const base = -Math.PI / 2 + u * 0.35 + (r() - 0.5) * 0.4;
        for (let q = 0; q < n; q++) {
          const a = base + (q / (n - 1) - 0.5) * 1.7;
          const L = len0 * (0.75 + r() * 0.45);
          strokes.push({
            x: tx + Math.cos(a) * L * 0.5,
            y: ty + Math.sin(a) * L * 0.5,
            len: L,
            ang: a,
            alpha: shade,
            sway: 0.025,
          });
        }
      }
    }
    // the underside: a fine dark edge
    for (const k of clouds) {
      for (let x = k.x - k.rx * 0.9; x < k.x + k.rx * 0.9; x += len0 * 0.7) {
        const u = (x - k.x) / k.rx;
        const y = k.y + k.ry * 0.45 * Math.sqrt(1 - u * u);
        if (inside(x, y + 2)) continue; // only where it is the true underside
        strokes.push({ x, y: y - 1, len: len0 * 0.9, ang: (r() - 0.5) * 0.4, alpha: 0.75, sway: 0.025 });
      }
    }
  };
  const branches = [
    { t: 0.3, side: -1, reach: 0.44, rise: 0.03 },
    { t: 0.42, side: 1, reach: 0.34, rise: 0.05 },
    { t: 0.55, side: -1, reach: 0.3, rise: 0.05 },
    { t: 0.66, side: 1, reach: 0.27, rise: 0.06 },
    { t: 0.77, side: -1, reach: 0.2, rise: 0.05 },
    { t: 0.87, side: 1, reach: 0.16, rise: 0.05 },
  ];
  branches.forEach((b, k) => {
    const p = at(b.t);
    const end = { x: p.x + b.side * S * b.reach, y: p.y - S * b.rise };
    const bw = Math.max(1.5, w0 * 0.55 * (1 - b.t * 0.7));
    // out and slightly down, then lifting at the tip
    g.strokeStyle = grey(0.62);
    for (const [wd, from, to] of [
      [bw, 0, 0.5],
      [bw * 0.6, 0.45, 1],
    ] as const) {
      const pt = (t: number) => {
        const cxq = p.x + b.side * S * b.reach * 0.55;
        const cyq = p.y + S * 0.03;
        const u = 1 - t;
        return { x: u * u * p.x + 2 * u * t * cxq + t * t * end.x, y: u * u * p.y + 2 * u * t * cyq + t * t * end.y };
      };
      g.lineWidth = wd;
      g.beginPath();
      for (let s = 0; s <= 10; s++) {
        const q = pt(from + ((to - from) * s) / 10);
        if (s === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      }
      g.stroke();
    }
    const rx = S * (0.11 + 0.13 * (1 - b.t));
    pad(end.x - b.side * rx * 0.3, end.y - rx * 0.1, rx, rx * 0.5, 40 + k * 13);
  });
  const top = at(1);
  pad(top.x, top.y - S * 0.035, S * 0.11, S * 0.065, 7);

  // moss on the soil
  for (let x = px0 + S * 0.02; x < px0 + potW - S * 0.02; x += 2) {
    if (rand() < 0.35) continue;
    strokes.push({
      x: x + rand() * 2,
      y: soil - S * 0.02 - rand() * S * 0.012,
      len: 2.5 + rand() * 3,
      ang: -Math.PI / 2 + (rand() - 0.5) * 1.4,
      alpha: 0.55 + rand() * 0.3,
      sway: 0.01,
    });
  }

  const data = g.getImageData(0, 0, W, H).data;
  const ink = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) ink[p] = 1 - data[p * 4] / 255;
  return { ink, W, H, labels: [], strokes };
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
  const ink = (x: number, y: number) =>
    p.ink[Math.min(p.H - 1, Math.max(0, y)) * p.W + Math.min(p.W - 1, Math.max(0, x))];
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

      // names on trees, if any
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
    <canvas ref={ref} aria-hidden="true" className={`pointer-events-none absolute inset-0 font-mono ${className}`} />
  );
}
