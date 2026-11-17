"use client";

import { useEffect, useRef } from "react";

/*
 * A big old tree, a Japanese torii gate and an English red telephone box,
 * drawn as ASCII in black on white.
 *
 * The tree comes from an illustration (public/hero-tree.webp); the torii,
 * standing back to the left, and the telephone box, in front to the right, are
 * drawn here as simple geometric forms. All three go onto one hidden canvas
 * (the tree multiplied in, so its white background keeps what is behind it)
 * and the canvas is read as characters: edges become | / \ - by their
 * direction (a structure tensor on the full painting), tone becomes the symbol
 * of matching measured ink. A line of grass along the ground is drawn as free
 * strokes that sway. The characters are drawn once.
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

// ---------- the painting: a big old tree, a torii gate and a red telephone box ----------

type Label = { text: string; x: number; y: number };

/** a grass blade: a short free stroke, not on the character grid */
type Stroke = { x: number; y: number; len: number; ang: number; alpha: number; sway: number };

type Painting = {
  /** ink per pixel of the hidden canvas, 0 paper .. 1 black */
  ink: Float32Array;
  W: number;
  H: number;
  labels: Label[];
  /** grass along the ground, drawn as strokes over the characters */
  strokes: Stroke[];
};

/** the tree illustration (public/hero-tree.webp): where its ground line sits, as a fraction of its height */
const TREE_GROUND = 0.885;

function paintForest(w: number, h: number, ground: number, tree: HTMLImageElement | null): Painting {
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

  const gy = ground * (mobile ? 0.95 : 0.94); // the ground line
  const T = mobile ? Math.min(w * 0.82, (gy - 150) * 1.05) : Math.min(w * 0.5, (gy - 160) * 1.02); // tree size
  const tx = w * (mobile ? 0.52 : 0.6);

  /** a torii: two pillars, a curved top beam with upturned ends, a tie beam, a central strut */
  const torii = (x: number, base: number, s: number) => {
    const fill = (path: () => void, ink: number) => {
      g.beginPath();
      path();
      g.closePath();
      g.fillStyle = grey(ink);
      g.fill();
      g.strokeStyle = grey(1);
      g.lineWidth = line;
      g.stroke();
    };
    const half = s * 0.36; // pillar spacing
    const pw = s * 0.045;
    const top = base - s * 0.86;
    for (const side of [-1, 1]) {
      const xb = x + side * half;
      const xt = x + side * half * 0.92; // pillars lean in a little
      fill(() => {
        g.moveTo(xb - pw, base);
        g.lineTo(xt - pw * 0.8, top);
        g.lineTo(xt + pw * 0.8, top);
        g.lineTo(xb + pw, base);
      }, 0.62);
      fill(() => g.rect(xb - pw * 1.5, base - s * 0.05, pw * 3, s * 0.05), 0.85); // the black foot
    }
    // nuki: the tie beam, through the pillars
    fill(() => g.rect(x - half * 1.28, top + s * 0.17, half * 2.56, s * 0.045), 0.58);
    // gakuzuka: the central strut
    fill(() => g.rect(x - pw * 0.7, top + s * 0.03, pw * 1.4, s * 0.14), 0.58);
    // shimaki and kasagi: the top beams, the upper one sweeping up at the ends
    fill(() => g.rect(x - half * 1.3, top - s * 0.01, half * 2.6, s * 0.045), 0.6);
    fill(() => {
      const L = half * 1.55;
      g.moveTo(x - L, top - s * 0.12);
      g.quadraticCurveTo(x, top - s * 0.03, x + L, top - s * 0.12);
      g.lineTo(x + L * 0.93, top - s * 0.06);
      g.quadraticCurveTo(x, top + s * 0.01, x - L * 0.93, top - s * 0.06);
    }, 0.85);
  };

  /** a red telephone box (K6): domed roof, sign band, glazing bars, a plinth */
  const phoneBox = (x: number, base: number, s: number) => {
    const bw = s * 0.36;
    const bh = s;
    const x0 = x - bw / 2;
    const top = base - bh;
    g.strokeStyle = grey(1);
    g.lineWidth = line;
    // plinth
    g.fillStyle = grey(0.5);
    g.fillRect(x0 - bw * 0.06, base - s * 0.035, bw * 1.12, s * 0.035);
    g.strokeRect(x0 - bw * 0.06, base - s * 0.035, bw * 1.12, s * 0.035);
    // body
    const body = g.createLinearGradient(x0, 0, x0 + bw, 0);
    body.addColorStop(0, grey(0.7));
    body.addColorStop(1, grey(0.5));
    g.fillStyle = body;
    g.fillRect(x0, top + s * 0.1, bw, bh - s * 0.135);
    g.strokeRect(x0, top + s * 0.1, bw, bh - s * 0.135);
    // the domed roof
    g.beginPath();
    g.moveTo(x0 - bw * 0.04, top + s * 0.1);
    g.quadraticCurveTo(x, top - s * 0.02, x0 + bw * 1.04, top + s * 0.1);
    g.closePath();
    g.fillStyle = grey(0.65);
    g.fill();
    g.stroke();
    // the TELEPHONE sign: a pale band
    g.fillStyle = grey(0.08);
    g.fillRect(x0 + bw * 0.12, top + s * 0.12, bw * 0.76, s * 0.05);
    g.strokeRect(x0 + bw * 0.12, top + s * 0.12, bw * 0.76, s * 0.05);
    // the door's glazing: small panes in three columns
    const gx0 = x0 + bw * 0.14;
    const gw = bw * 0.72;
    const gy0 = top + s * 0.21;
    const gh = s * 0.56;
    const cols = 3;
    const rows = 8;
    const pane = { w: gw / cols, h: gh / rows };
    g.fillStyle = "#fff";
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const px = gx0 + k * pane.w + pane.w * 0.14;
        const py = gy0 + r * pane.h + pane.h * 0.14;
        g.fillRect(px, py, pane.w * 0.72, pane.h * 0.72);
      }
    g.strokeRect(gx0, gy0, gw, gh);
  };

  // behind: the torii, a little further back, to the left of the tree
  const toriiS = mobile ? T * 0.3 : T * 0.27;
  torii(mobile ? w * 0.16 : Math.max(w * 0.36, tx - T * 0.42), gy - T * 0.015, toriiS);

  // the tree, from the illustration: multiplied in, so its white background leaves what is behind
  if (tree && tree.naturalWidth) {
    const ih = T;
    const iw = (tree.naturalWidth / tree.naturalHeight) * ih;
    g.globalCompositeOperation = "multiply";
    g.drawImage(tree, tx - iw / 2, gy - ih * TREE_GROUND, iw, ih);
    g.globalCompositeOperation = "source-over";
  }

  // in front: the red telephone box, to the right
  phoneBox(mobile ? w * 0.89 : Math.min(w * 0.9, tx + T * 0.5), gy + T * 0.01, mobile ? T * 0.3 : T * 0.3);

  // the ground: a soft line of grass running between them
  for (let x = w * (mobile ? 0 : 0.27); x < w * (mobile ? 1 : 0.95); x += 2.5) {
    if (rand() < 0.3) continue;
    strokes.push({
      x,
      y: gy + 2 - rand() * 4,
      len: 2.5 + rand() * 4,
      ang: -Math.PI / 2 + (rand() - 0.5) * 1.2,
      alpha: 0.5 + rand() * 0.3,
      sway: 0.04,
    });
  }

  const data = g.getImageData(0, 0, W, H).data;
  const ink = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const v = 1 - (0.3 * data[p * 4] + 0.59 * data[p * 4 + 1] + 0.11 * data[p * 4 + 2]) / 255;
    ink[p] = v < 0.08 ? 0 : v; // the illustration's near-white stays paper
  }
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

      cells = readCells(paintForest(w, h, ground, tree), w, h, cw, ch, clearings);
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
          const v = c.tone[k] ** 1.15;
          const e = c.edge[k];
          if (v < 0.03 && !e) continue;
          const ci = e ? (ink.index.get(e) ?? 0) : ink.lut[Math.min(63, Math.round(v * 63))];
          if (ci === 0) continue;
          o.globalAlpha = Math.min(1, 0.35 + c.tone[k]); // light tones in light ink
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

    // the tree illustration: draw without it at first, again once it has loaded
    const tree = new Image();
    tree.src = "/hero-tree.webp";
    tree.decode().then(setup, () => {});
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
