"use client";

import { useEffect, useRef } from "react";

/*
 * The world as a garden, seen from above and drawn in black ASCII.
 *
 * The garden's paths are a prefix tree: they leave the root at the bottom
 * edge, meet at stone plazas ("pr", "pro") and end at the trees that are the
 * words (prefix, product, prototype, project). Wild trees, grass, flowers and
 * a pond fill the rest. Canopies are shaded like spheres lit from the top
 * left, cast shadows to the bottom right, and rustle in a slow wind that
 * picks up around the pointer.
 *
 * Elements inside the hero marked `data-garden-clear` get a clearing so their
 * text stays readable.
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

// ---------- the trie, as a garden plan (x, y as fractions of the hero) ----------

type PlanNode = {
  id: string;
  x: number;
  y: number;
  parent?: string;
  /** what the path into this node spells */
  edge?: string;
  /** a whole word: this node is a tree */
  word?: string;
};

const PLAN: PlanNode[] = [
  { id: "root", x: 0.5, y: 1.06 },
  { id: "pr", x: 0.5, y: 0.75, parent: "root", edge: "pr" },
  { id: "prefix", x: 0.25, y: 0.49, parent: "pr", edge: "efix", word: "prefix" },
  { id: "pro", x: 0.63, y: 0.53, parent: "pr", edge: "o" },
  { id: "product", x: 0.43, y: 0.31, parent: "pro", edge: "duct", word: "product" },
  { id: "prototype", x: 0.73, y: 0.26, parent: "pro", edge: "totype", word: "prototype" },
  { id: "project", x: 0.87, y: 0.47, parent: "pro", edge: "ject", word: "project" },
];

// phones: the hero card sits in the bottom third, so the plan lives above it
const MOBILE_PLAN: Record<string, [number, number]> = {
  root: [0.5, 0.82],
  pr: [0.5, 0.64],
  prefix: [0.2, 0.47],
  pro: [0.7, 0.5],
  product: [0.3, 0.29],
  prototype: [0.78, 0.23],
  project: [0.84, 0.39],
};

// ---------- cells ----------

const GROUND = 0;
const PATH = 1;
const EDGE = 2;
const CANOPY = 3;
const WATER = 4;
const TEXT = 5;
const STONE = 6;
const FLOWER = 7;
const SHADOW = 8;
const CLEAR = 9;

const RAMP = " .:-=+*#%@";
const GRASS = [".", ",", "'", "`", ".", ","];
const FLOWERS = ["*", "o", "+", "*", "x"];

type Tree = { x: number; y: number; r: number; phase: number; seed: number };

type Garden = {
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  kind: Uint8Array;
  base: Float32Array;
  phase: Float32Array;
  glyph: string[];
  alpha: Float32Array;
};

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

function buildGarden(
  w: number,
  h: number,
  cw: number,
  ch: number,
  clearings: DOMRect[],
): Garden {
  const cols = Math.ceil(w / cw);
  const rows = Math.ceil(h / ch);
  const n = cols * rows;
  const kind = new Uint8Array(n);
  const base = new Float32Array(n);
  const phase = new Float32Array(n);
  const alpha = new Float32Array(n).fill(1);
  const glyph: string[] = new Array(n).fill("");

  const mobile = w < 640;
  const s = mobile ? w * 1.75 : Math.min(w, h * 1.4);
  const nodes = PLAN.map((p) => {
    const [fx, fy] = mobile ? MOBILE_PLAN[p.id] : [p.x, p.y];
    return { ...p, px: fx * w, py: fy * h };
  });
  const byId = Object.fromEntries(nodes.map((p) => [p.id, p]));

  // paths: each edge a quadratic curve, sampled into segments
  type Seg = { ax: number; ay: number; bx: number; by: number; width: number };
  const segs: Seg[] = [];
  const edgeLabels: { text: string; x: number; y: number }[] = [];
  for (const node of nodes) {
    if (!node.parent) continue;
    const p = byId[node.parent];
    const depth = node.parent === "root" ? 0 : node.parent === "pr" ? 1 : 2;
    const width = Math.max(cw * 1.1, (s * 0.022) / (1 + depth * 0.35));
    const cx = node.px;
    const cy = p.py;
    const steps = 24;
    let lx = p.px;
    let ly = p.py;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = (1 - t) * (1 - t) * p.px + 2 * (1 - t) * t * cx + t * t * node.px;
      const y = (1 - t) * (1 - t) * p.py + 2 * (1 - t) * t * cy + t * t * node.py;
      segs.push({ ax: lx, ay: ly, bx: x, by: y, width });
      lx = x;
      ly = y;
    }
    if (node.edge && !mobile) {
      const t = node.parent === "root" ? 0.55 : 0.45;
      const x = (1 - t) * (1 - t) * p.px + 2 * (1 - t) * t * cx + t * t * node.px;
      const y = (1 - t) * (1 - t) * p.py + 2 * (1 - t) * t * cy + t * t * node.py;
      edgeLabels.push({ text: node.edge, x: node.parent === "root" ? x + cw * 4 : x, y });
    }
  }

  // plazas at the inner nodes, trees at the words
  const plazas = nodes
    .filter((p) => p.id === "pr" || p.id === "pro")
    .map((p) => ({ x: p.px, y: p.py, r: s * (p.id === "pr" ? 0.06 : 0.048), label: p.id }));

  const wordTrees: (Tree & { word: string })[] = nodes
    .filter((p) => p.word)
    .map((p, i) => ({
      x: p.px,
      y: p.py,
      r: s * (p.id === "prefix" ? 0.1 : 0.082),
      phase: i * 1.7,
      seed: 100 + i,
      word: p.word!,
    }));

  const pathDist = (x: number, y: number) => {
    let best = Infinity;
    for (const g of segs) {
      const d = distToSegment(x, y, g.ax, g.ay, g.bx, g.by) - g.width;
      if (d < best) best = d;
    }
    return best;
  };

  // the pond
  const pond = mobile
    ? { x: w * 0.13, y: h * 0.68, rx: s * 0.08, ry: s * 0.05 }
    : { x: w * 0.12, y: h * 0.24, rx: s * 0.11, ry: s * 0.065 };

  // wild trees, scattered where nothing else grows
  const rand = mulberry32(7);
  const trees: Tree[] = [...wordTrees];
  const target = Math.round((w * h) / (mobile ? 13000 : 20000));
  for (let tries = 0; tries < target * 30 && trees.length < target + wordTrees.length; tries++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = s * (mobile ? 0.012 + rand() * rand() * 0.03 : 0.016 + rand() * rand() * 0.036);
    if (pathDist(x, y) < r + cw * 1.5) continue;
    if (plazas.some((p) => Math.hypot(x - p.x, y - p.y) < p.r + r + cw * 2)) continue;
    if (((x - pond.x) / (pond.rx + r)) ** 2 + ((y - pond.y) / (pond.ry + r)) ** 2 < 1.3) continue;
    if (trees.some((t) => Math.hypot(x - t.x, y - t.y) < (t.r + r) * 0.92)) continue;
    trees.push({ x, y, r, phase: rand() * 6.28, seed: Math.floor(rand() * 1000) });
  }

  // light from the top left, a little above
  const L = [-0.5, -0.62, 0.6];
  const ll = Math.hypot(L[0], L[1], L[2]);
  L[0] /= ll;
  L[1] /= ll;
  L[2] /= ll;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const x = (i + 0.5) * cw;
      const y = (j + 0.5) * ch;

      // canopies: topmost (lowest on screen) wins
      let canopy = -1;
      let cv = 0;
      for (let t = 0; t < trees.length; t++) {
        const tr = trees[t];
        const u = (x - tr.x) / tr.r;
        const v = (y - tr.y) / tr.r;
        const d2 = u * u + v * v;
        if (d2 > 1.6) continue;
        const ang = Math.atan2(v, u);
        const edge = 1 + 0.14 * (fbm(Math.cos(ang) * 1.6 + tr.seed, Math.sin(ang) * 1.6, 3) - 0.5) * 2;
        const d = Math.sqrt(d2);
        if (d > edge) continue;
        const dn = Math.min(1, d / edge);
        const nz = Math.sqrt(Math.max(0, 1 - dn * dn));
        const nx = (u / (d || 1)) * dn;
        const ny = (v / (d || 1)) * dn;
        const lambert = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const k = 9 / Math.max(1, tr.r / 30);
        const leaves = fbm((x / tr.r) * k + tr.seed, (y / tr.r) * k, 11);
        const val = 0.1 + 0.62 * (1 - lambert) + 0.75 * (leaves - 0.5) + 0.1 * dn;
        if (canopy === -1 || tr.y > trees[canopy].y) {
          canopy = t;
          cv = val;
        }
      }
      if (canopy !== -1) {
        kind[idx] = CANOPY;
        base[idx] = Math.max(0.08, Math.min(1, cv));
        phase[idx] = trees[canopy].phase + fbm(i * 0.25, j * 0.25, 5) * 3;
        continue;
      }

      // pond
      const pu = (x - pond.x) / pond.rx;
      const pv = (y - pond.y) / pond.ry;
      const pd = Math.sqrt(pu * pu + pv * pv) + 0.12 * (fbm(i * 0.2, j * 0.2, 9) - 0.5);
      if (pd < 1) {
        kind[idx] = WATER;
        base[idx] = 0.3 + 0.4 * (1 - pd);
        phase[idx] = i * 0.45 + j * 0.9;
        continue;
      }
      if (pd < 1.12) {
        kind[idx] = STONE;
        glyph[idx] = hash(i, j, 4) < 0.35 ? "o" : ".";
        alpha[idx] = 0.55;
        continue;
      }

      // plazas: a ring of stones around an open floor
      let plazaHit = false;
      for (const pl of plazas) {
        const d = Math.hypot(x - pl.x, y - pl.y);
        if (d < pl.r - cw * 0.7) {
          kind[idx] = PATH;
          plazaHit = true;
          break;
        }
        if (d < pl.r + cw * 0.5) {
          kind[idx] = STONE;
          glyph[idx] = hash(i, j, 6) < 0.7 ? "o" : "0";
          alpha[idx] = 0.8;
          plazaHit = true;
          break;
        }
      }
      if (plazaHit) continue;

      // paths: open gravel, edged with a dotted kerb, flowers along it
      const pdist = pathDist(x, y);
      if (pdist < 0) {
        kind[idx] = PATH;
        if (hash(i, j, 2) < 0.05) {
          glyph[idx] = "·";
          alpha[idx] = 0.35;
        }
        continue;
      }
      if (pdist < cw * 0.9) {
        kind[idx] = EDGE;
        glyph[idx] = hash(i, j, 3) < 0.75 ? "." : ":";
        alpha[idx] = 0.7;
        continue;
      }
      if (pdist < cw * 2.6 && hash(i, j, 8) < 0.1) {
        kind[idx] = FLOWER;
        glyph[idx] = FLOWERS[Math.floor(hash(i, j, 12) * FLOWERS.length)];
        alpha[idx] = 0.75;
        continue;
      }

      // cast shadows, to the bottom right of every tree
      let shade = 0;
      for (const tr of trees) {
        const u = (x - tr.x - tr.r * 0.38) / tr.r;
        const v = (y - tr.y - tr.r * 0.3) / tr.r;
        const d2 = u * u + v * v;
        if (d2 < 1) shade = Math.max(shade, 0.42 * (1 - d2 * d2));
      }
      if (shade > 0.05) {
        kind[idx] = SHADOW;
        base[idx] = shade;
        phase[idx] = hash(i, j, 21) * 6.28;
        continue;
      }

      // grass, thicker in meadow patches
      kind[idx] = GROUND;
      base[idx] = 0.16 + 0.42 * fbm(i * 0.06, j * 0.11, 1) ** 1.5;
      phase[idx] = hash(i, j, 13) * 6.28;
    }
  }

  // clearings behind the hero's own text
  for (const r of clearings) {
    const pad = cw * 2;
    const i0 = Math.max(0, Math.floor((r.left - pad) / cw));
    const i1 = Math.min(cols - 1, Math.ceil((r.right + pad) / cw));
    const j0 = Math.max(0, Math.floor((r.top - pad * 0.6) / ch));
    const j1 = Math.min(rows - 1, Math.ceil((r.bottom + pad * 0.6) / ch));
    const mx = (r.left + r.right) / 2;
    const my = (r.top + r.bottom) / 2;
    const ax = r.width / 2 + pad;
    const ay = r.height / 2 + pad * 0.6;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const u = ((i + 0.5) * cw - mx) / ax;
        const v = ((j + 0.5) * ch - my) / ay;
        const d = Math.max(Math.abs(u) ** 4 + Math.abs(v) ** 4, 0);
        const idx = j * cols + i;
        if (d < 0.75) kind[idx] = CLEAR;
        else if (d < 1 && hash(i, j, 30) < 0.6) kind[idx] = CLEAR;
      }
    }
  }

  // names, written into the grid like name plates
  const write = (text: string, x: number, y: number, a: number, plate: boolean) => {
    const j = Math.round(y / ch - 0.5);
    const i0 = Math.round(x / cw - text.length / 2);
    if (j < 0 || j >= rows) return;
    const from = plate ? -1 : 0;
    const to = plate ? text.length : text.length - 1;
    for (let k = from; k <= to; k++) {
      const i = i0 + k;
      if (i < 0 || i >= cols) continue;
      const idx = j * cols + i;
      if (kind[idx] === CLEAR) continue;
      kind[idx] = TEXT;
      glyph[idx] = k >= 0 && k < text.length ? text[k] : "";
      alpha[idx] = a;
    }
  };
  for (const e of edgeLabels) write(e.text, e.x + cw * 3.5, e.y, 0.55, true);
  for (const p of plazas) write(p.label, p.x, p.y, 0.9, false);
  for (const t of wordTrees) write(t.word, t.x, t.y + t.r + ch * 1.1, 1, true);

  return { cols, rows, cw, ch, kind, base, phase, glyph, alpha };
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
    const cells: { c: string; i: number; j: number }[][] = Array.from({ length: BUCKETS }, () => []);

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

      garden = buildGarden(w, h, cw, ch, clearings);
      draw(performance.now());
    };

    const draw = (now: number) => {
      const g = garden;
      if (!g) return;
      const t = reduced ? 0 : now / 1000;
      for (const b of cells) b.length = 0;

      const pcol = pointer.x / g.cw;
      const prow = pointer.y / g.ch;
      const gustR = 9;

      for (let j = 0; j < g.rows; j++) {
        for (let i = 0; i < g.cols; i++) {
          const idx = j * g.cols + i;
          const k = g.kind[idx];
          let c = "";
          let a = g.alpha[idx];

          let gust = 0;
          if (pointer.energy > 0.01) {
            const dx = (i - pcol) / gustR;
            const dy = ((j - prow) * 2) / gustR;
            const d2 = dx * dx + dy * dy;
            if (d2 < 1) gust = (1 - d2) * pointer.energy;
          }
          // a slow wave of wind moving across the garden
          const wind = Math.sin(i * 0.09 - j * 0.05 - t * 0.9) * 0.5 + 0.5;

          switch (k) {
            case GROUND: {
              const v = g.base[idx] + gust * 0.15;
              if (hash(i, j, 40) < v * 1.5) {
                const sway = Math.sin(g.phase[idx] + t * (1.2 + gust * 6) + wind * 2);
                c = sway > 0.6 ? "'" : sway < -0.6 ? "," : GRASS[Math.floor(hash(i, j, 41) * GRASS.length)];
                a = 0.2 + v * 0.75;
              }
              break;
            }
            case SHADOW: {
              const v = g.base[idx];
              if (hash(i, j, 42) < 0.35 + v) {
                c = v > 0.3 ? ";" : ":";
                a = 0.2 + v * 0.8;
              }
              break;
            }
            case CANOPY: {
              const rustle =
                Math.sin(g.phase[idx] + t * (1.4 + gust * 7)) * (0.06 + wind * 0.07 + gust * 0.22);
              const v = Math.max(0, Math.min(0.999, g.base[idx] + rustle));
              c = RAMP[Math.floor(v * RAMP.length)];
              a = 0.28 + v * 0.72;
              break;
            }
            case WATER: {
              const ripple = Math.sin(g.phase[idx] - t * 1.6 + gust * 3);
              c = ripple > 0.4 ? "~" : ripple > -0.5 ? "-" : hash(i, j, 43) < 0.5 ? "." : "";
              a = g.base[idx];
              break;
            }
            case PATH:
            case EDGE:
            case STONE:
            case FLOWER:
            case TEXT:
              c = g.glyph[idx];
              if (k === FLOWER) a *= 0.8 + 0.2 * Math.sin(t * 2 + i);
              break;
          }
          if (!c || c === " ") continue;
          const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor(a * BUCKETS)));
          cells[b].push({ c, i, j });
        }
      }

      const w = g.cols * g.cw;
      const h = g.rows * g.ch;
      ctx.clearRect(0, 0, w, h);
      for (let b = 0; b < BUCKETS; b++) {
        if (!cells[b].length) continue;
        ctx.fillStyle = `rgba(23, 23, 23, ${((b + 1) / BUCKETS).toFixed(3)})`;
        for (const cell of cells[b]) {
          ctx.fillText(cell.c, (cell.i + 0.5) * g.cw, (cell.j + 0.5) * g.ch);
        }
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
