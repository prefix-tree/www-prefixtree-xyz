"use client";

import { useEffect, useRef } from "react";

/*
 * A Japanese garden at the edge of a forest, in black on white: needles as
 * free strokes, solid things as a grid of characters.
 *
 * Behind: pale hills and a soft row of spruces, taller ones closing in at the
 * sides, a mossy bank where the garden begins. In the garden: cloud-pruned
 * pines (niwaki) with curving trunks and flat pads of needles, dark on the
 * underside; a stone lantern; a group of mossy rocks in raked rings; stepping
 * stones; raked gravel in long lines that part around the rings.
 *
 * Needles are drawn as short strokes off the character grid and sway in a
 * slow wind. Trunks, rocks, the lantern and stones are painted on a hidden
 * canvas and read as characters: edges become | / \ - by their direction (a
 * structure tensor on the full painting), tone becomes the symbol of matching
 * measured ink. The characters are drawn once.
 *
 * Elements inside the hero marked `data-garden-clear` get a clearing so their
 * text stays readable; a visible `data-garden-ground` element marks where the
 * garden stops being seen (on phones, the hero card).
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

// ---------- the painting: a Japanese garden at the edge of a forest ----------

type Label = { text: string; x: number; y: number };

/** a needle or a line of raked gravel: a short free stroke, not on the character grid */
type Stroke = {
  x: number;
  y: number;
  len: number;
  ang: number;
  alpha: number;
  sway: number;
  kind?: "bg" | "fg" | "ground";
};

type Painting = {
  /** ink per pixel of the hidden canvas (trunks, rocks, lantern, stones), 0 paper .. 1 black */
  ink: Float32Array;
  W: number;
  H: number;
  labels: Label[];
  /** needles and gravel, drawn as strokes over the characters */
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
    const len0 = Math.max(3, height / 55);
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers; // 0 bottom .. 1 top
      const yb = base - trunkH - f * (height - trunkH) * 0.92; // the tier's lower edge
      const hw = (width / 2) * (1 - f) ** 0.7 + width * 0.04; // a fuller, rounder outline
      const th = ((height - trunkH) / tiers) * 1.9;
      const apex = Math.max(top, yb - th);
      const path = new Path2D();
      path.moveTo(x, apex);
      path.quadraticCurveTo(x - hw * 0.45, yb - th * 0.45, x - hw, yb + th * 0.12);
      // soft scallops along the lower edge rather than sharp teeth
      const teeth = Math.max(3, Math.round(hw / (height * 0.04)));
      for (let q = 1; q <= teeth; q++) {
        const px = x - hw + (2 * hw * q) / teeth;
        const sag = th * 0.12 * Math.sin((Math.PI * q) / teeth);
        path.quadraticCurveTo(px - hw / teeth, yb + th * (0.22 + rand() * 0.06) + sag, px, yb + th * 0.06 + sag);
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
            ang: Math.PI / 2 - u * 0.45 + (rand() - 0.5) * 0.4, // hanging, leaning a little outward
            alpha: strength * (0.35 + 0.65 * dense),
            sway: 0.05 + 0.05 * strength,
          });
        }
      }
    }
    // the leader at the very top
    for (let q = 0; q < 4; q++)
      strokes.push({ x, y: top + q * len0 * 0.6, len: len0, ang: Math.PI / 2, alpha: strength, sway: 0.04 });
  };

  /** a stroke that does not sway: raked gravel, outlines drawn with needles */
  const still = (x: number, y: number, len: number, ang: number, alpha: number, kind: Stroke["kind"]) =>
    strokes.push({ x, y, len, ang, alpha, sway: 0, kind });

  /**
   * a cloud-pruned pine (niwaki): a curving trunk for the character grid and
   * flat pads of needles at the ends of its branches, dark on the underside
   */
  const pads: Path2D[] = [];
  const niwaki = (x: number, base: number, height: number, lean: number, count: number) => {
    const r = mulberry32(Math.round(x + height));
    const P = [
      { x, y: base },
      { x: x + lean * height * 0.35, y: base - height * 0.3 },
      { x: x - lean * height * 0.25, y: base - height * 0.62 },
      { x: x + lean * height * 0.12, y: base - height * 0.9 },
    ];
    const at = (t: number) => {
      const u = 1 - t;
      return {
        x: u * u * u * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t * t * t * P[3].x,
        y: u * u * u * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t * t * t * P[3].y,
      };
    };
    const w0 = height * 0.05;
    const w1 = height * 0.012;
    // trunk, tapering, with a little root flare
    const left: { x: number; y: number }[] = [];
    const right: { x: number; y: number }[] = [];
    for (let s = 0; s <= 30; s++) {
      const t = s / 30;
      const p = at(t);
      const q = at(Math.min(1, t + 0.01));
      const p0 = at(Math.max(0, t - 0.01));
      const dx = q.x - p0.x;
      const dy = q.y - p0.y;
      const l = Math.hypot(dx, dy) || 1;
      const wd = w1 + (w0 - w1) * (1 - t) ** 1.4 + (t < 0.08 ? (0.08 - t) * height * 0.5 : 0);
      left.push({ x: p.x - (dy / l) * -wd, y: p.y + (dx / l) * -wd });
      right.push({ x: p.x + (dy / l) * -wd, y: p.y - (dx / l) * -wd });
    }
    g.beginPath();
    left.forEach((p, s) => (s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    right.reverse().forEach((p) => g.lineTo(p.x, p.y));
    g.closePath();
    const tg = g.createLinearGradient(x - w0, 0, x + w0, 0);
    tg.addColorStop(0, grey(0.55));
    tg.addColorStop(1, grey(0.3));
    g.fillStyle = tg;
    g.fill();
    g.strokeStyle = grey(1);
    g.lineWidth = line;
    g.stroke();

    const len0 = Math.max(2.6, height / 75);
    const step = Math.max(2.2, height / 200);
    const padAt = (cx: number, cy: number, rx: number, ry: number) => {
      // the pad: a few overlapping ellipses, like a cloud
      const path = new Path2D();
      const lumps = 4;
      for (let k = 0; k < lumps; k++) {
        const u = (k / (lumps - 1) - 0.5) * 2;
        path.ellipse(
          cx + u * rx * 0.55,
          cy - (1 - u * u) * ry * 0.35,
          rx * 0.5,
          ry * (0.75 + 0.25 * (1 - u * u)),
          0,
          0,
          Math.PI * 2,
        );
      }
      pads.push(path);
      for (let py = cy - ry * 1.4; py < cy + ry * 1.1; py += step) {
        for (let px = cx - rx * 1.1; px < cx + rx * 1.1; px += step) {
          const sx = px + (r() - 0.5) * step;
          const sy = py + (r() - 0.5) * step;
          if (!g.isPointInPath(path, sx, sy)) continue;
          const v = Math.min(1, Math.max(0, (sy - (cy - ry * 1.2)) / (ry * 2.2))); // 0 top .. 1 underside
          const u = (sx - cx) / rx;
          const dense = (0.38 + 0.62 * v ** 1.4) * (1 - 0.3 * Math.max(0, u));
          if (r() > dense) continue;
          strokes.push({
            x: sx,
            y: sy,
            len: len0 * (0.7 + r() * 0.6),
            ang: -Math.PI / 2 + u * 0.6 + (r() - 0.5) * 1.1, // needles, softly every way, leaning out
            alpha: 0.3 + 0.65 * v,
            sway: 0.03,
            kind: "fg",
          });
        }
      }
      // the underside: a dark, softly scalloped edge
      for (let px = cx - rx; px < cx + rx; px += step * 0.8) {
        const u = (px - cx) / rx;
        const y = cy + ry * 0.75 * Math.sqrt(Math.max(0, 1 - u * u)) + Math.sin(u * 9) * ry * 0.08;
        strokes.push({ x: px, y, len: len0 * 0.8, ang: (r() - 0.5) * 0.9, alpha: 0.6, sway: 0.03, kind: "fg" });
      }
    };
    // branches out to the pads, alternating sides, the top pad on the apex
    for (let k = 0; k < count; k++) {
      const f = 0.32 + (0.6 * k) / Math.max(1, count - 1);
      const p = at(f);
      const side = (k % 2 ? 1 : -1) * (lean < 0 ? -1 : 1);
      const reach = height * (0.2 + 0.12 * (1 - f));
      const end = { x: p.x + side * reach, y: p.y - height * (0.04 + r() * 0.03) };
      g.strokeStyle = grey(0.85);
      g.lineWidth = Math.max(1.5, w0 * 0.4 * (1 - f * 0.6));
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.quadraticCurveTo(p.x + side * reach * 0.5, p.y + height * 0.01, end.x, end.y);
      g.stroke();
      const rx = height * (0.15 + 0.08 * (1 - f));
      padAt(end.x + side * rx * 0.15, end.y - rx * 0.16, rx, rx * 0.42);
    }
    const top = at(1);
    padAt(top.x, top.y - height * 0.04, height * 0.12, height * 0.055);
  };

  /** a stone lantern (tōrō): slab, post, platform, light box with a window, wide roof, finial */
  const lantern = (x: number, base: number, s: number) => {
    const part = (cx: number, y: number, wd: number, ht: number, ink: number) => {
      const lg = g.createLinearGradient(cx - wd / 2, 0, cx + wd / 2, 0);
      lg.addColorStop(0, grey(ink + 0.15));
      lg.addColorStop(1, grey(ink - 0.15));
      g.fillStyle = lg;
      g.fillRect(cx - wd / 2, y - ht, wd, ht);
      g.strokeStyle = grey(1);
      g.lineWidth = line;
      g.strokeRect(cx - wd / 2, y - ht, wd, ht);
    };
    let y = base;
    part(x, y, s * 0.42, s * 0.06, 0.45);
    y -= s * 0.06;
    part(x, y, s * 0.13, s * 0.34, 0.5);
    y -= s * 0.34;
    part(x, y, s * 0.36, s * 0.06, 0.45);
    y -= s * 0.06;
    part(x, y, s * 0.26, s * 0.2, 0.5);
    g.fillStyle = "#fff";
    g.fillRect(x - s * 0.06, y - s * 0.16, s * 0.12, s * 0.12); // the window
    g.strokeRect(x - s * 0.06, y - s * 0.16, s * 0.12, s * 0.12);
    y -= s * 0.2;
    // roof with upturned corners
    g.beginPath();
    g.moveTo(x - s * 0.36, y - s * 0.01);
    g.quadraticCurveTo(x - s * 0.2, y - s * 0.03, x - s * 0.1, y - s * 0.14);
    g.lineTo(x + s * 0.1, y - s * 0.14);
    g.quadraticCurveTo(x + s * 0.2, y - s * 0.03, x + s * 0.36, y - s * 0.01);
    g.lineTo(x + s * 0.3, y + s * 0.015);
    g.lineTo(x - s * 0.3, y + s * 0.015);
    g.closePath();
    const rg = g.createLinearGradient(x - s * 0.36, 0, x + s * 0.36, 0);
    rg.addColorStop(0, grey(0.7));
    rg.addColorStop(1, grey(0.4));
    g.fillStyle = rg;
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(x, y - s * 0.17, s * 0.035, 0, Math.PI * 2);
    g.fillStyle = grey(0.55);
    g.fill();
    g.stroke();
  };

  /** a rock: an irregular rounded stone, lit from the right, with moss on top */
  const rock = (x: number, base: number, wd: number, ht: number) => {
    const r = mulberry32(Math.round(x * 7 + ht));
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k <= 9; k++) {
      const a = Math.PI + (Math.PI * k) / 9;
      const j = 0.8 + r() * 0.3;
      pts.push({ x: x + Math.cos(a) * wd * 0.5 * j, y: base + Math.sin(a) * ht * j });
    }
    g.beginPath();
    g.moveTo(x - wd * 0.55, base);
    pts.forEach((p) => g.lineTo(p.x, p.y));
    g.lineTo(x + wd * 0.55, base);
    g.closePath();
    const rg = g.createLinearGradient(x - wd / 2, 0, x + wd / 2, 0);
    rg.addColorStop(0, grey(0.72));
    rg.addColorStop(1, grey(0.32));
    g.fillStyle = rg;
    g.fill();
    g.strokeStyle = grey(1);
    g.lineWidth = line;
    g.stroke();
    // moss: short tufts along the top
    for (let k = 0; k < wd * 0.9; k++) {
      const u = r() * 0.8 + 0.1;
      const a = Math.PI + Math.PI * u;
      strokes.push({
        x: x + Math.cos(a) * wd * 0.45,
        y: base + Math.sin(a) * ht * 0.9 - r() * 3,
        len: 3 + r() * 3,
        ang: -Math.PI / 2 + (r() - 0.5) * 1.2,
        alpha: 0.75,
        sway: 0.02,
        kind: "fg",
      });
    }
  };

  // ---------- the far forest: pale hills, then a soft row of spruces ----------
  const edge = ground * (mobile ? 0.52 : 0.5); // where the forest meets the garden
  for (const [k, ink] of [
    [0.24, 0.06],
    [0.15, 0.1],
  ] as const) {
    g.beginPath();
    g.moveTo(0, edge);
    for (let x = 0; x <= w; x += 8)
      g.lineTo(x, edge - ground * k * (0.55 + 0.45 * Math.sin(x / (w * 0.22) + k * 20) * Math.sin(x / (w * 0.09) + k)));
    g.lineTo(w, edge);
    g.closePath();
    g.fillStyle = grey(ink);
    g.fill();
  }
  for (let x = -10; x < w + 10; ) {
    const ht = ground * (0.14 + rand() * 0.12);
    spruce(x, edge + ground * 0.01, ht, 0.32, false);
    x += ht * (0.3 + rand() * 0.25);
  }
  // taller spruces at the sides, the forest closing in
  const sides = mobile ? [0.02, 0.98] : [0.03, 0.12, 0.9, 0.98];
  for (const fx of sides) spruce(fx * w, edge + ground * 0.08, ground * (0.48 + rand() * 0.12), 0.5, false);
  for (const st of strokes) st.kind = "bg";

  // a mossy bank where the garden begins
  for (let x = 0; x < w; x += 3) {
    const y = edge + ground * 0.03 + Math.sin(x / 70) * 3;
    for (let k = 0; k < 2; k++)
      still(x + rand() * 3, y + rand() * 5, 3 + rand() * 4, -Math.PI / 2 + (rand() - 0.5) * 1.3, 0.45, "bg");
  }

  // ---------- the garden ----------
  const gTop = edge + ground * 0.08;
  const L = mobile
    ? {
        pine: { x: 0.42, base: 0.9, ht: 0.56, lean: -1, pads: 4 },
        small: null,
        lantern: { x: 0.84, base: 0.84, s: 0.22 },
        rocks: { x: 0.74, base: 0.97, s: 0.045 },
      }
    : {
        pine: { x: 0.44, base: 0.9, ht: 0.64, lean: -1, pads: 5 },
        small: { x: 0.9, base: 0.84, ht: 0.34, lean: 1, pads: 3 },
        lantern: { x: 0.77, base: 0.8, s: 0.24 },
        rocks: { x: 0.6, base: 0.88, s: 0.06 },
      };

  // stepping stones running into the garden toward the lantern
  const stones: { x: number; y: number; rx: number; ry: number }[] = [];
  for (let k = 0; k < 5; k++) {
    const t = k / 4;
    const y = ground * (1.0 - t * (1.0 - L.lantern.base - 0.02));
    const x = w * (0.55 + (L.lantern.x - 0.55) * t) + Math.sin(k * 2.1) * w * 0.02;
    const rx = ground * (0.05 - t * 0.025);
    stones.push({ x, y, rx, ry: rx * 0.35 });
  }
  for (const s of stones) {
    g.beginPath();
    g.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
    g.fillStyle = grey(0.18);
    g.fill();
    g.strokeStyle = grey(0.8);
    g.lineWidth = line;
    g.stroke();
  }

  // rocks in a group, with raked rings around them
  const R = L.rocks;
  const rx0 = R.x * w;
  const rb = R.base * ground;
  const rs = R.s * ground;
  rock(rx0 - rs * 0.9, rb, rs * 1.5, rs * 1.1);
  rock(rx0 + rs * 0.5, rb + rs * 0.12, rs * 2.0, rs * 1.6);
  rock(rx0 + rs * 1.6, rb + rs * 0.2, rs * 0.9, rs * 0.6);
  const ring = { x: rx0 + rs * 0.3, y: rb, rx: rs * 2.6, ry: rs * 0.8 };

  lantern(L.lantern.x * w, L.lantern.base * ground, L.lantern.s * ground);
  if (L.small) niwaki(L.small.x * w, L.small.base * ground, L.small.ht * ground, L.small.lean, L.small.pads);
  niwaki(L.pine.x * w, L.pine.base * ground, L.pine.ht * ground, L.pine.lean, L.pine.pads);

  // raked gravel: lines across the garden, rings around the rocks
  const rings = 5;
  const gap = rs * 0.32;
  const ringR = (k: number) => 1 + (k * gap) / ring.rx;
  for (let k = 0; k <= rings; k++) {
    const f = ringR(k);
    const n = Math.round(ring.rx * f * 0.9);
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2;
      const x = ring.x + Math.cos(a) * ring.rx * f;
      const y = ring.y + Math.sin(a) * ring.ry * f;
      still(
        x,
        y,
        ((Math.PI * 2 * ring.rx * f) / n) * 1.15,
        Math.atan2(Math.cos(a) * ring.ry, -Math.sin(a) * ring.rx),
        0.32,
        "ground",
      );
    }
  }
  const lines = mobile ? 16 : 22;
  for (let k = 0; k < lines; k++) {
    const y = gTop + (h - gTop) * (k / lines) ** 1.35;
    const tone = 0.14 + 0.18 * (k / lines);
    for (let x = 0; x < w; x += 3) {
      const wy = y + Math.sin(x / 90 + k * 0.7) * 1.5;
      const d = ((x - ring.x) / ring.rx) ** 2 + ((wy - ring.y) / ring.ry) ** 2;
      if (d < ringR(rings + 0.6) ** 2) continue; // the lines part around the rings
      if (stones.some((s) => ((x - s.x) / (s.rx + 4)) ** 2 + ((wy - s.y) / (s.ry + 3)) ** 2 < 1)) continue;
      still(x, wy, 3.4, Math.cos(x / 90 + k * 0.7) * 0.017, tone, "ground");
    }
  }

  const data = g.getImageData(0, 0, W, H).data;
  const ink = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) ink[p] = 1 - data[p * 4] / 255;
  // background needles and gravel stay behind the pads, trunks, stones and lantern
  const kept = strokes.filter((st) => {
    if (st.kind === "fg") return true;
    if (st.kind === "bg" && pads.some((p) => g.isPointInPath(p, st.x, st.y))) return false;
    const x = Math.round(st.x);
    const y = Math.round(st.y);
    const yy = Math.min(H - 1, Math.max(0, y));
    for (let dx = -3; dx <= 3; dx += 3) if (ink[yy * W + Math.min(W - 1, Math.max(0, x + dx))] > 0.3) return false;
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
