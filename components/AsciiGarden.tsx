"use client";

import { useEffect, useRef } from "react";

/*
 * The world as a garden, seen the way you would stand in it, drawn in black
 * ASCII on paper.
 *
 * In the middle grows the prefix tree: its trunk is "pr", its boughs spell
 * the rest ("efix", "o" then "duct", "totype", "ject"), and each whole word is
 * a crown of leaves (prefix, product, prototype, project). Roots reach into the
 * soil. Around it stand the garden's other trees, a far tree line on the
 * horizon and grass that thickens toward the viewer. Leaves are shaded like
 * spheres lit from the top left and rustle in a slow wind that picks up
 * around the pointer; a few birds cross the sky.
 *
 * Elements inside the hero marked `data-garden-clear` get a clearing so their
 * text stays readable; a visible `data-garden-ground` element sets the
 * horizon at its bottom edge (on phones, where the hero card is in the flow).
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

// ---------- cells ----------

const EMPTY = 0;
const FOLIAGE = 1;
const GRASS = 2;
const BLADE = 3;
const GLYPH = 4; // a fixed character: bark, roots, labels, stems, flowers
const CLEAR = 9;

const RAMP = " .:-=+*#%@";
const GRASS_FAR = [".", "_", ".", "-", "."];
const GRASS_MID = [".", ",", "'", "`", '"', ","];
const GRASS_NEAR = [",", ";", "'", '"', "v", "w", ","];
const FLOWERS = ["*", "o", "@", "+", "*"];

type Garden = {
  w: number;
  h: number;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  kind: Uint8Array;
  base: Float32Array;
  phase: Float32Array;
  alpha: Float32Array;
  glyph: string[];
};

type P = { x: number; y: number };

function quad(a: P, c: P, b: P, t: number): P {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** the character a stroke going this way draws with */
function strokeChar(dx: number, dy: number) {
  const a = (Math.atan2(-dy, dx) * 180) / Math.PI; // up is positive
  const m = ((a % 180) + 180) % 180;
  if (m < 22 || m > 158) return "-";
  if (m < 68) return "/";
  if (m < 112) return "|";
  return "\\";
}

function buildGarden(
  w: number,
  h: number,
  cw: number,
  ch: number,
  clearings: DOMRect[],
  ground: number | null,
): Garden {
  const cols = Math.ceil(w / cw);
  const rows = Math.ceil(h / ch);
  const n = cols * rows;
  const g: Garden = {
    w,
    h,
    cols,
    rows,
    cw,
    ch,
    kind: new Uint8Array(n),
    base: new Float32Array(n),
    phase: new Float32Array(n),
    alpha: new Float32Array(n),
    glyph: new Array(n).fill(""),
  };

  const mobile = w < 640;
  // the horizon, where the trees stand: on phones, just above the hero card
  const y0 = ground ?? h * 0.74;
  const cx = w * 0.5;
  const S = mobile ? Math.min(w * 0.62, (y0 - 170) / 1.1) : Math.min(w * 0.5, (y0 - 165) / 1.1);
  const rand = mulberry32(11);

  const cellsIn = (x0: number, y0_: number, x1: number, y1: number, fn: (i: number, j: number, x: number, y: number) => void) => {
    const i0 = Math.max(0, Math.floor(x0 / cw));
    const i1 = Math.min(cols - 1, Math.ceil(x1 / cw));
    const j0 = Math.max(0, Math.floor(y0_ / ch));
    const j1 = Math.min(rows - 1, Math.ceil(y1 / ch));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j, (i + 0.5) * cw, (j + 0.5) * ch);
  };
  const put = (i: number, j: number, kind: number, a: number, glyph = "", base = 0, phase = 0) => {
    const idx = j * cols + i;
    g.kind[idx] = kind;
    g.alpha[idx] = a;
    g.glyph[idx] = glyph;
    g.base[idx] = base;
    g.phase[idx] = phase;
  };

  // light from the top left
  const L = (() => {
    const v = [-0.55, -0.6, 0.58];
    const l = Math.hypot(v[0], v[1], v[2]);
    return v.map((c) => c / l);
  })();

  /** one ball of leaves, shaded like a lit sphere, lumpy at the edge */
  const blob = (bx: number, by: number, rx: number, ry: number, seed: number, a: number) => {
    cellsIn(bx - rx * 1.2, by - ry * 1.2, bx + rx * 1.2, by + ry * 1.2, (i, j, x, y) => {
      const u = (x - bx) / rx;
      const v = (y - by) / ry;
      const d = Math.sqrt(u * u + v * v);
      if (d > 1.2) return;
      const ang = Math.atan2(v, u);
      const edge = 1 + 0.32 * (fbm(Math.cos(ang) * 1.8 + seed, Math.sin(ang) * 1.8 + seed, 3) - 0.5);
      if (d > edge) return;
      const dn = Math.min(1, d / edge);
      const nz = Math.sqrt(Math.max(0, 1 - dn * dn));
      const nx = (u / (d || 1)) * dn;
      const ny = (v / (d || 1)) * dn;
      const lambert = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const k = 6 / Math.max(1, rx / 40);
      const leaves = fbm((x / rx) * k + seed, (y / rx) * k * 1.4, 11);
      const val = 0.26 + 0.62 * (1 - lambert) + 0.55 * (leaves - 0.5);
      put(i, j, FOLIAGE, a, "", Math.max(0.14, Math.min(1, val)), seed * 0.7 + fbm(i * 0.3, j * 0.3, 5) * 3);
    });
  };

  /** a crown: a cluster of blobs, the lower ones in front */
  const crown = (x: number, y: number, rx: number, ry: number, seed: number, a: number, lumps = 5) => {
    const r = mulberry32(seed);
    const parts: { x: number; y: number; rx: number; ry: number }[] = [{ x, y, rx: rx * 0.78, ry: ry * 0.8 }];
    for (let k = 0; k < lumps; k++) {
      const ang = (k / lumps) * Math.PI * 2 + r() * 0.8;
      const dist = 0.38 + r() * 0.22;
      const sz = 0.42 + r() * 0.2;
      parts.push({ x: x + Math.cos(ang) * rx * dist, y: y + Math.sin(ang) * ry * dist, rx: rx * sz, ry: ry * sz * 1.05 });
    }
    parts.sort((p, q) => p.y - q.y);
    parts.forEach((p, k) => blob(p.x, p.y, p.rx, p.ry, seed * 13 + k, a));
  };

  /** a limb: a tapering curve drawn with the stroke characters */
  const limb = (a: P, c: P, b: P, w0: number, w1: number, al: number, bark = false) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y);
    const steps = Math.max(8, Math.ceil(len / (Math.min(cw, ch) * 0.5)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const p = quad(a, c, b, t);
      const q = quad(a, c, b, Math.min(1, t + 0.02));
      const p0 = quad(a, c, b, Math.max(0, t - 0.02));
      const ch_ = strokeChar(q.x - p0.x, q.y - p0.y);
      const wd = w0 + (w1 - w0) * t;
      const half = Math.max(cw * 0.5, wd);
      cellsIn(p.x - half, p.y - ch * 0.5, p.x + half, p.y + ch * 0.5, (i, j, x, y) => {
        if (Math.abs(x - p.x) > half || Math.abs(y - p.y) > ch * 0.6) return;
        const idx = j * cols + i;
        if (g.kind[idx] === GLYPH && g.alpha[idx] >= al) return;
        let glyph = ch_;
        if (bark && wd > cw * 1.2) {
          const edge = Math.abs(x - p.x) > half - cw;
          glyph = edge ? (x < p.x ? "(" : ")") : hash(i, j, 77) < 0.25 ? ":" : "|";
        }
        put(i, j, GLYPH, al, glyph);
      });
    }
  };

  // ---------- ground: grass thickening toward us ----------
  cellsIn(0, y0, w, h, (i, j, x, y) => {
    const t = Math.min(1, (y - y0) / (h - y0));
    let base = 0.1 + 0.5 * t ** 1.2 + 0.35 * (fbm(i * 0.05, j * 0.12, 1) - 0.5);
    // the big tree's shade
    const su = (x - cx - S * 0.1) / (S * 0.55);
    const sv = (y - y0 - S * 0.03) / (S * 0.06);
    if (su * su + sv * sv < 1) base += 0.25 * (1 - su * su - sv * sv);
    put(i, j, GRASS, t, "", base, hash(i, j, 13) * 6.28);
    if (t > 0.78 && hash(i, j, 14) < 0.12 + (t - 0.78) * 1.4) put(i, j, BLADE, 0.7, "", 0, hash(i, j, 15) * 6.28);
  });
  const horizonRow = Math.floor(y0 / ch);
  for (let i = 0; i < cols; i++) if (hash(i, 1, 16) < 0.7) put(i, horizonRow, GLYPH, 0.3, "_");
  // flowers on stems
  cellsIn(0, y0 + (h - y0) * 0.25, w, h - ch * 2, (i, j) => {
    if (hash(i, j, 17) < 0.018) {
      put(i, j, GLYPH, 0.8, FLOWERS[Math.floor(hash(i, j, 18) * FLOWERS.length)]);
      if (j + 1 < rows) put(i, j + 1, GLYPH, 0.45, "|");
    }
  });

  // ---------- the far tree line ----------
  for (let x = -20; x < w + 40; ) {
    const r = 18 + rand() * 30;
    crown(x, y0 - r * (0.35 + rand() * 0.4), r * 1.2, r * 0.85, Math.floor(rand() * 900), 0.22, 3);
    x += r * (1.1 + rand() * 0.6);
  }
  cellsIn(0, y0 - ch * 1.5, w, y0 - 1, (i, j) => {
    if (g.kind[j * cols + i] === EMPTY) put(i, j, FOLIAGE, 0.22, "", 0.35 + 0.3 * hash(i, j, 19), hash(i, j, 20) * 6);
  });

  // ---------- the garden's other trees ----------
  type Wild = { x: number; base: number; k: number; conifer: boolean; seed: number };
  const wild: Wild[] = [];
  const want = Math.max(3, Math.round(w / 210));
  for (let tries = 0; tries < 400 && wild.length < want; tries++) {
    const x = rand() * w;
    if (Math.abs(x - cx) < S * (mobile ? 0.4 : 0.5)) continue;
    const near = rand();
    const k = 0.55 + near * 0.75;
    if (wild.some((t) => Math.abs(t.x - x) < 60 * (t.k + k))) continue;
    wild.push({ x, base: y0 + near * (h - y0) * 0.22, k, conifer: rand() < 0.35, seed: Math.floor(rand() * 999) });
  }
  wild.sort((p, q) => p.base - q.base);
  for (const t of wild) {
    const a = 0.45 + 0.4 * ((t.base - y0) / ((h - y0) * 0.22));
    const size = (mobile ? 0.8 : 1) * t.k;
    if (t.conifer) {
      const ht = (110 + (t.seed % 50)) * size;
      const wd = ht * 0.34;
      limb({ x: t.x, y: t.base }, { x: t.x, y: t.base - ht * 0.1 }, { x: t.x, y: t.base - ht * 0.2 }, wd * 0.08, wd * 0.07, a, true);
      const top = t.base - ht;
      cellsIn(t.x - wd, top, t.x + wd, t.base - ht * 0.12, (i, j, x, y) => {
        const yr = (y - top) / (ht * 0.88);
        const tiers = 4;
        const half = wd * yr * (0.72 + 0.28 * ((yr * tiers) % 1));
        const dx = x - t.x;
        if (Math.abs(dx) > half) return;
        const lit = 0.5 - (dx / (half || 1)) * 0.3 + yr * 0.25;
        const v = lit + 0.5 * (fbm(i * 0.5, j * 0.5, t.seed) - 0.5);
        put(i, j, FOLIAGE, a, "", Math.max(0.08, Math.min(1, v)), t.seed + i * 0.2);
      });
    } else {
      const rx = (34 + (t.seed % 26)) * size;
      const trunk = (36 + (t.seed % 30)) * size;
      const lean = ((t.seed % 7) - 3) * 2;
      limb({ x: t.x, y: t.base }, { x: t.x, y: t.base - trunk * 0.5 }, { x: t.x + lean, y: t.base - trunk }, rx * 0.11, rx * 0.06, a, true);
      crown(t.x + lean, t.base - trunk - rx * 0.55, rx, rx * 0.78, t.seed, a);
    }
  }

  // ---------- the prefix tree ----------
  const at = (dx: number, dy: number): P => ({ x: cx + dx * S, y: y0 - dy * S });
  const base = at(0, 0);
  const pr = at(-0.02, 0.36);
  const pro = at(0.14, 0.6);
  const words = [
    { word: "prefix", node: at(-0.42, 0.7), from: pr, edge: "efix", w0: 0.026, r: 0.19 },
    { word: "product", node: at(-0.07, 0.93), from: pro, edge: "duct", w0: 0.018, r: 0.15 },
    { word: "prototype", node: at(0.33, 0.98), from: pro, edge: "totype", w0: 0.018, r: 0.15 },
    { word: "project", node: at(0.55, 0.72), from: pro, edge: "ject", w0: 0.018, r: 0.15 },
  ];

  // roots, reaching into the soil
  const rootEnds: [number, number][] = [[-0.3, -0.1], [-0.14, -0.16], [0.02, -0.18], [0.17, -0.14], [0.32, -0.08]];
  for (const [dx, dy] of rootEnds) {
    const end = at(dx, dy);
    limb(at(dx * 0.15, 0.01), { x: cx + dx * S * 0.6, y: y0 + 4 }, end, S * 0.016, S * 0.003, 0.5);
  }
  // trunk ("pr"), the "o" bough, then the twigs to each word
  limb(base, at(-0.04, 0.18), pr, S * 0.055, S * 0.04, 0.95, true);
  limb(pr, at(0.12, 0.45), pro, S * 0.034, S * 0.026, 0.92, true);
  for (const wd of words) {
    // rise first, then lean out toward the word
    const ctrl = { x: wd.from.x + (wd.node.x - wd.from.x) * 0.2, y: wd.from.y + (wd.node.y - wd.from.y) * 0.6 };
    limb(wd.from, ctrl, wd.node, S * wd.w0, S * 0.008, 0.9, true);
    // a few twigs fanning out under the crown
    for (let k = -1; k <= 1; k++) {
      const tip = { x: wd.node.x + k * S * wd.r * 0.45, y: wd.node.y - S * wd.r * 0.75 };
      limb(wd.node, { x: wd.node.x + k * S * wd.r * 0.2, y: wd.node.y - S * wd.r * 0.2 }, tip, S * 0.006, S * 0.002, 0.85);
    }
  }
  words.forEach((wd, k) =>
    crown(wd.node.x, wd.node.y - S * wd.r * 0.3, S * wd.r * 1.25, S * wd.r * 0.85, 300 + k * 41, 1, 6),
  );

  // ---------- clearings behind the hero's own text ----------
  for (const r of clearings) {
    const pad = cw * 2;
    const mx = (r.left + r.right) / 2;
    const my = (r.top + r.bottom) / 2;
    const ax = r.width / 2 + pad;
    const ay = r.height / 2 + pad * 0.6;
    cellsIn(mx - ax, my - ay, mx + ax, my + ay, (i, j, x, y) => {
      const d = Math.abs((x - mx) / ax) ** 4 + Math.abs((y - my) / ay) ** 4;
      if (d < 0.75 || (d < 1 && hash(i, j, 30) < 0.6)) g.kind[j * cols + i] = CLEAR;
    });
  }

  // ---------- names, written into the picture ----------
  const write = (text: string, x: number, y: number, a: number, align: "center" | "left" | "right" = "center") => {
    const j = Math.round(y / ch - 0.5);
    if (j < 0 || j >= rows) return;
    const start =
      align === "center" ? Math.round(x / cw - text.length / 2) : align === "left" ? Math.round(x / cw) : Math.round(x / cw) - text.length;
    for (let k = -1; k <= text.length; k++) {
      const i = start + k;
      if (i < 0 || i >= cols || g.kind[j * cols + i] === CLEAR) continue;
      put(i, j, GLYPH, a, k >= 0 && k < text.length ? text[k] : "");
    }
  };
  write("pr", pr.x + S * 0.06, (base.y + pr.y) / 2, 0.6, "left");
  write("o", (pr.x + pro.x) / 2 + S * 0.05, (pr.y + pro.y) / 2 + ch, 0.6, "left");
  for (const wd of words) {
    const mid = { x: (wd.from.x + wd.node.x) / 2, y: (wd.from.y + wd.node.y) / 2 + S * 0.04 };
    const left = wd.node.x < wd.from.x;
    if (wd.word === "product") write(wd.edge, mid.x - S * 0.03, mid.y, 0.6, "right");
    else write(wd.edge, mid.x + (left ? -S * 0.03 : S * 0.03), mid.y, 0.6, left ? "right" : "left");
    write(wd.word, wd.node.x, wd.node.y - S * wd.r * 0.3, 1);
  }

  return g;
}

// ---------- drawing ----------

const BUCKETS = 8;

export default function AsciiGarden({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const host = canvas.parentElement!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let garden: Garden | null = null;
    let raf = 0;
    let last = 0;
    let visible = true;
    const pointer = { x: -1e4, y: -1e4, energy: 0 };
    const cells: { c: string; x: number; y: number }[][] = Array.from({ length: BUCKETS }, () => []);

    const setup = () => {
      const rect = host.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const size = w < 640 ? 11 : 13;
      const family = getComputedStyle(canvas).fontFamily || "monospace";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${size}px ${family}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const cw = Math.max(5, ctx.measureText("M").width);
      const ch = Math.round(size * 1.18);

      const clearings = Array.from(host.querySelectorAll<HTMLElement>("[data-garden-clear]"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return new DOMRect(r.left - rect.left, r.top - rect.top, r.width, r.height);
        });

      const groundEl = host.querySelector<HTMLElement>("[data-garden-ground]");
      const ground =
        groundEl && groundEl.offsetParent !== null
          ? groundEl.getBoundingClientRect().bottom - rect.top - ch * 3
          : null;

      garden = buildGarden(w, h, cw, ch, clearings, ground);
      draw(performance.now());
    };

    const draw = (now: number) => {
      const g = garden;
      if (!g) return;
      const t = reduced ? 0 : now / 1000;
      for (const b of cells) b.length = 0;
      const push = (c: string, a: number, x: number, y: number) => {
        const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor(a * BUCKETS)));
        cells[b].push({ c, x, y });
      };

      const pcol = pointer.x / g.cw;
      const prow = pointer.y / g.ch;
      const gustR = 10;

      for (let j = 0; j < g.rows; j++) {
        for (let i = 0; i < g.cols; i++) {
          const idx = j * g.cols + i;
          const k = g.kind[idx];
          if (k === EMPTY || k === CLEAR) continue;

          let gust = 0;
          if (pointer.energy > 0.01) {
            const dx = (i - pcol) / gustR;
            const dy = ((j - prow) * 2) / gustR;
            const d2 = dx * dx + dy * dy;
            if (d2 < 1) gust = (1 - d2) * pointer.energy;
          }
          // a slow wave of wind moving across the garden
          const wind = Math.sin(i * 0.08 - t * 0.8) * 0.5 + 0.5;
          const x = (i + 0.5) * g.cw;
          const y = (j + 0.5) * g.ch;

          if (k === FOLIAGE) {
            const rustle = Math.sin(g.phase[idx] + t * (1.3 + gust * 7)) * (0.05 + wind * 0.07 + gust * 0.22);
            const v = Math.max(0, Math.min(0.999, g.base[idx] + rustle));
            const c = RAMP[Math.floor(v * RAMP.length)];
            if (c !== " ") push(c, g.alpha[idx] * (0.3 + 0.7 * v), x, y);
          } else if (k === GRASS) {
            const depth = g.alpha[idx];
            const v = g.base[idx] + gust * 0.2;
            if (hash(i, j, 40) < v * 1.3) {
              const set = depth < 0.3 ? GRASS_FAR : depth < 0.65 ? GRASS_MID : GRASS_NEAR;
              const sway = Math.sin(g.phase[idx] + t * (1.1 + gust * 6) + wind * 2);
              const c = depth > 0.3 && Math.abs(sway) > 0.75 ? (sway > 0 ? "'" : ",") : set[Math.floor(hash(i, j, 41) * set.length)];
              push(c, 0.22 + 0.55 * Math.min(1, v) + depth * 0.15, x, y);
            }
          } else if (k === BLADE) {
            const sway = Math.sin(g.phase[idx] + t * 1.4 + wind * 2.5 + gust * 4);
            push(sway > 0.35 ? "/" : sway < -0.35 ? "\\" : "|", g.alpha[idx], x, y);
          } else if (k === GLYPH) {
            const c = g.glyph[idx];
            if (c) push(c, g.alpha[idx], x, y);
          }
        }
      }

      // a few birds crossing the sky
      for (let b = 0; b < 3; b++) {
        const span = g.w + 160;
        const bx = ((t * (14 + b * 5) + b * 380) % span) - 80;
        const by = g.h * (0.2 + b * 0.07) + Math.sin(t * 0.6 + b * 2) * 10;
        const flap = Math.sin(t * 5 + b * 1.7) > 0;
        push(flap ? "v" : "-", 0.55, bx, by);
      }

      ctx.clearRect(0, 0, g.w, g.h);
      for (let b = 0; b < BUCKETS; b++) {
        if (!cells[b].length) continue;
        ctx.fillStyle = `rgba(23, 23, 23, ${((b + 1) / BUCKETS).toFixed(3)})`;
        for (const cell of cells[b]) ctx.fillText(cell.c, cell.x, cell.y);
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < 90) return; // ~11 fps: ASCII should tick, not glide
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
