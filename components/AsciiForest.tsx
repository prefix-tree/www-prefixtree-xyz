"use client";

import { useEffect, useRef } from "react";

/*
 * One big, old, friendly tree, drawn as a digital tree: wood as a grid of
 * characters, leaves as free strokes.
 *
 * A thick trunk twists up from flaring roots and splits into four limbs (the
 * longest low to the left), which fork again and again. Their tips carry
 * clusters of leaves, light on top and dark underneath, the whole crown darker
 * away from the light at the top left, with gaps where the branches show. A
 * bush and tall grass grow at its foot.
 *
 * Leaves and grass are short strokes off the character grid and sway a little.
 * The wood is painted on a hidden canvas (outlines first, fills on top, so the
 * joints have no seams) and read as characters: edges become | / \ - by their
 * direction (a structure tensor on the full painting), tone becomes the
 * symbol of matching measured ink. The characters are drawn once.
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

// ---------- the painting: one big, old, friendly tree ----------

type Label = { text: string; x: number; y: number };

/** a leaf or a grass blade: a short free stroke, not on the character grid */
type Stroke = { x: number; y: number; len: number; ang: number; alpha: number; sway: number };

type Painting = {
  /** ink per pixel of the hidden canvas (trunk, limbs, roots), 0 paper .. 1 black */
  ink: Float32Array;
  W: number;
  H: number;
  labels: Label[];
  /** leaves and grass, drawn as strokes over the characters */
  strokes: Stroke[];
};

type Pt = { x: number; y: number };

function paintForest(w: number, h: number, ground: number): Painting {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);

  const rand = mulberry32(5);
  const mobile = w < 640;
  const grey = (ink: number) => {
    const v = Math.round(255 * (1 - Math.max(0, Math.min(1, ink))));
    return `rgb(${v},${v},${v})`;
  };
  const line = Math.max(1.4, Math.min(w, h) / 420);
  const strokes: Stroke[] = [];
  g.lineJoin = "round";
  g.lineCap = "round";

  // size and place: the tree is about as wide as it is tall, plus a little
  const gy = ground * (mobile ? 0.95 : 0.94); // where it stands
  const S = mobile ? Math.min(w * 0.68, (gy - 170) * 0.95) : Math.min(w * 0.46, (gy - 200) * 0.85);
  const cx = w * (mobile ? 0.5 : 0.57);

  // ---------- wood: every limb is a tapered polygon; outlines first, fills on top, so joints have no seams ----------
  const wood: Path2D[] = [];
  const limb = (a: Pt, ctrl: Pt, b: Pt, w0: number, w1: number) => {
    const L: Pt[] = [];
    const R: Pt[] = [];
    const n = 18;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const u = 1 - t;
      const p = {
        x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
      };
      const dx = 2 * u * (ctrl.x - a.x) + 2 * t * (b.x - ctrl.x);
      const dy = 2 * u * (ctrl.y - a.y) + 2 * t * (b.y - ctrl.y);
      const l = Math.hypot(dx, dy) || 1;
      const wd = w0 + (w1 - w0) * t;
      L.push({ x: p.x - (dy / l) * wd, y: p.y + (dx / l) * wd });
      R.push({ x: p.x + (dy / l) * wd, y: p.y - (dx / l) * wd });
    }
    const path = new Path2D();
    path.moveTo(L[0].x, L[0].y);
    L.forEach((p) => path.lineTo(p.x, p.y));
    R.reverse().forEach((p) => path.lineTo(p.x, p.y));
    path.closePath();
    wood.push(path);
  };

  // the trunk: thick, twisting, flaring into roots
  const base = { x: cx - S * 0.02, y: gy };
  const fork = { x: cx + S * 0.03, y: gy - S * 0.36 };
  limb(base, { x: cx - S * 0.12, y: gy - S * 0.2 }, fork, S * 0.065, S * 0.045);
  for (const [dx, dy, wd] of [
    [-0.26, 0.01, 0.03],
    [-0.13, 0.02, 0.025],
    [0.2, 0.012, 0.028],
    [0.33, 0.004, 0.016],
  ] as const) {
    const end = { x: base.x + dx * S, y: gy + dy * S };
    limb(
      { x: base.x + dx * S * 0.12, y: gy - S * 0.08 },
      { x: base.x + dx * S * 0.45, y: gy - S * 0.005 },
      end,
      S * wd,
      S * 0.004,
    );
  }

  // limbs fork again and again; their tips carry the leaves
  const tips: { x: number; y: number; r: number }[] = [];
  const grow = (from: Pt, ang: number, len: number, wd: number, depth: number, leaves = true) => {
    const to = { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
    const bend = (rand() - 0.5) * 1.1;
    const mid = {
      x: (from.x + to.x) / 2 + Math.cos(ang + Math.PI / 2) * len * bend * 0.3,
      y: (from.y + to.y) / 2 + Math.sin(ang + Math.PI / 2) * len * bend * 0.3,
    };
    limb(from, mid, to, wd, wd * 0.62);
    if (depth === 0 || wd < 1.2) {
      if (leaves) tips.push({ x: to.x, y: to.y, r: S * (0.06 + rand() * 0.035) });
      return;
    }
    if (depth <= 1 && leaves) tips.push({ x: mid.x, y: mid.y - len * 0.1, r: S * (0.05 + rand() * 0.03) });
    const kids = 2 + (rand() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const spread = (k / (kids - 1) - 0.5) * 1.1 + (rand() - 0.5) * 0.35;
      // children lean toward the light: a little upward
      let a = ang + spread;
      a = a + (-Math.PI / 2 - a) * 0.18;
      grow(to, a, len * (0.66 + rand() * 0.12), wd * 0.62, depth - 1, leaves);
    }
  };
  const deg = Math.PI / 180;
  grow(fork, -168 * deg, S * 0.25, S * 0.03, 3); // the long low arm to the left
  grow(fork, -118 * deg, S * 0.2, S * 0.034, 3);
  grow(fork, -72 * deg, S * 0.19, S * 0.032, 3);
  grow({ x: fork.x + S * 0.01, y: fork.y + S * 0.06 }, -22 * deg, S * 0.23, S * 0.026, 3);
  // a bare twig low on the right, as old trees have
  grow({ x: fork.x + S * 0.02, y: fork.y + S * 0.1 }, -8 * deg, S * 0.22, S * 0.012, 1, false);

  g.strokeStyle = grey(1);
  g.lineWidth = line * 2;
  wood.forEach((p) => g.stroke(p));
  const wg = g.createLinearGradient(cx - S * 0.4, 0, cx + S * 0.4, 0);
  wg.addColorStop(0, grey(0.48));
  wg.addColorStop(1, grey(0.22));
  g.fillStyle = wg;
  wood.forEach((p) => g.fill(p));
  // bark: a few long fissures up the trunk
  g.strokeStyle = grey(0.85);
  g.lineWidth = Math.max(1, line * 0.7);
  for (const f of [-0.35, 0.1, 0.45]) {
    g.beginPath();
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const u = 1 - t;
      const ctrl = { x: cx - S * 0.12, y: gy - S * 0.2 };
      const x =
        u * u * base.x + 2 * u * t * ctrl.x + t * t * fork.x + f * S * (0.06 - 0.02 * t) + Math.sin(t * 9 + f * 4) * 2;
      const y = u * u * base.y + 2 * u * t * ctrl.y + t * t * fork.y;
      if (s === 0) g.moveTo(x, y - S * 0.04);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  // ---------- the crown: a dome of leaf clusters, with gaps low down where the branches show ----------
  {
    const dc = { x: fork.x - S * 0.02, y: fork.y - S * 0.36 };
    const drx = S * 0.6;
    const dry = S * 0.36;
    const cell = S * 0.075;
    for (let y = dc.y - dry; y < dc.y + dry * 0.8; y += cell * 0.8) {
      for (let x = dc.x - drx; x < dc.x + drx; x += cell) {
        const px = x + (rand() - 0.5) * cell;
        const py = y + (rand() - 0.5) * cell * 0.8;
        const u = (px - dc.x) / drx;
        const v = (py - dc.y) / dry;
        const edge = 1 + 0.12 * Math.sin(Math.atan2(v, u) * 7);
        if (u * u + v * v > edge * edge) continue;
        // the lower part of the crown opens up, so the limbs show through
        if (v > 0.15 && rand() < 0.35 + v * 0.6) continue;
        tips.push({ x: px, y: py, r: S * (0.055 + rand() * 0.03) });
      }
    }
  }

  // ---------- leaves: clusters of short strokes, lit from the top left ----------
  const crown = tips.reduce(
    (b, t) => ({ x0: Math.min(b.x0, t.x), x1: Math.max(b.x1, t.x), y0: Math.min(b.y0, t.y), y1: Math.max(b.y1, t.y) }),
    {
      x0: Infinity,
      x1: -Infinity,
      y0: Infinity,
      y1: -Infinity,
    },
  );
  const ccx = (crown.x0 + crown.x1) / 2;
  const ccy = (crown.y0 + crown.y1) / 2;
  const leaf = Math.max(3, S / 95);
  const step = leaf * 0.85;
  for (const t of tips) {
    const r = mulberry32(Math.round(t.x * 13 + t.y));
    for (let y = t.y - t.r; y < t.y + t.r * 0.7; y += step) {
      for (let x = t.x - t.r; x < t.x + t.r; x += step) {
        const lx = x + (r() - 0.5) * step;
        const ly = y + (r() - 0.5) * step;
        const u = (lx - t.x) / t.r;
        const v = (ly - t.y) / t.r;
        const edge = 1 + 0.18 * Math.sin(Math.atan2(v, u) * 6 + t.x);
        if (u * u + (v < 0 ? v * v : (v / 0.7) ** 2) > edge * edge) continue;
        const low = (v + 1) / 1.7; // 0 top .. 1 underside of the cluster
        if (r() > 0.4 + 0.5 * low) continue;
        // the whole crown is darker to the bottom right, away from the light
        const away = 0.18 * ((lx - ccx) / (crown.x1 - crown.x0 + 1) + (ly - ccy) / (crown.y1 - crown.y0 + 1));
        strokes.push({
          x: lx,
          y: ly,
          len: leaf * (0.65 + r() * 0.6),
          ang: r() * Math.PI,
          alpha: Math.min(1, Math.max(0.2, 0.25 + 0.6 * low + away)),
          sway: 0.05,
        });
      }
    }
  }

  // ---------- at its foot: a bush on the right, tall grass on the left ----------
  for (let k = 0; k < 4; k++) {
    const bx = cx + S * (0.2 + k * 0.07);
    const by = gy - S * (0.05 + (k % 2) * 0.02);
    const br = S * (0.06 + (k === 1 ? 0.02 : 0));
    for (let y = by - br; y < by + br * 0.6; y += step) {
      for (let x = bx - br; x < bx + br; x += step) {
        const u = (x - bx) / br;
        const v = (y - by) / br;
        if (u * u + v * v > 1 || rand() > 0.5 + 0.4 * ((v + 1) / 2)) continue;
        strokes.push({
          x,
          y,
          len: leaf * (0.6 + rand() * 0.5),
          ang: rand() * Math.PI,
          alpha: 0.4 + 0.5 * ((v + 1) / 2),
          sway: 0.03,
        });
      }
    }
  }
  for (let k = 0; k < (mobile ? 9 : 14); k++) {
    const x0 = cx - S * (0.18 + rand() * 0.16);
    const len = S * (0.08 + rand() * 0.1);
    const lean = (rand() - 0.6) * 1.4;
    const segs = 6;
    let p = { x: x0, y: gy };
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const a = -Math.PI / 2 + lean * t * t;
      const q = { x: p.x + Math.cos(a) * (len / segs), y: p.y + Math.sin(a) * (len / segs) };
      strokes.push({
        x: (p.x + q.x) / 2,
        y: (p.y + q.y) / 2,
        len: len / segs + 1,
        ang: a,
        alpha: 0.55 + 0.3 * (1 - t),
        sway: 0.06 * t,
      });
      p = q;
    }
  }
  // the ground: a soft line of short grass
  for (let x = cx - S * 0.45; x < cx + S * 0.55; x += 2.5) {
    const fade = 1 - Math.abs((x - cx) / (S * 0.5)) ** 2;
    if (fade <= 0 || rand() > fade) continue;
    strokes.push({
      x,
      y: gy + 1 - rand() * 3,
      len: 2.5 + rand() * 3,
      ang: -Math.PI / 2 + (rand() - 0.5) * 1.2,
      alpha: 0.6,
      sway: 0.02,
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
