# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Site for Prefix Tree ([prefixtree.xyz](https://prefixtree.xyz)), the site of Local Group Software Corp (the company name in the footer, metadata and privacy policy). Next.js 16 App Router + Tailwind, hosted on Cloudflare Pages.

**Direction:** the company works on several products and open-source (OSS) projects, run by Bohdan Snisar and Pavel Grachev-Mousset. It is moving away from the earlier "applied-AI consultancy" pitch, so much of the existing content (consultancy copy) is expected to be dropped. Don't extend the old consultancy framing. The package was previously named "Overvu Solutions".

## Commands

Use pnpm (declared in `packageManager` in package.json). The stray `package-lock.json` is not the source of truth.

- `pnpm dev` — local dev server
- `pnpm build` — production build (also the only real check: type errors and lint fail the build)
- `pnpm lint` — `eslint .` (flat config in `eslint.config.mjs`, extends `eslint-config-next` core-web-vitals + typescript)

There is no test suite.

## Architecture

- `app/sitemap.ts` and `app/robots.ts` hardcode `https://prefixtree.xyz`; new pages must be added to the sitemap manually.
- `app/layout.tsx` holds the shared header/footer, site-wide metadata/OpenGraph, contact email, and the Libre Baskerville font (via `next/font/google`).
- Hero: `components/AsciiForest.tsx`, a Japanese garden at the edge of a forest in black on white: cloud-pruned pines (niwaki), a stone lantern, mossy rocks in raked rings, stepping stones and raked gravel, with a soft spruce forest and hills behind. Needles and gravel are free strokes (needles sway); trunks, rocks, lantern and stones are a hidden painting read as a character grid (edges by structure tensor become `| / \ -`, tone becomes the symbol of matching measured ink). Elements marked `data-garden-clear` get a clearing; a visible `data-garden-ground` element marks where the garden stops being seen (phones).
- Visual direction: "digital tree" aesthetic, loosely modelled on generalintelligencecompany.com's layout (full-height hero, floating glass nav, glass card, striped bands, airy serif statements) but with general, studio-wide copy rather than one product. Motifs: the pixel-art tree (`public/hero.png`), pixel grid, circuit-trace stripes, trie diagrams, `├──` tree-output labels.
- Fonts (wired in `app/layout.tsx` and `tailwind.config.ts`): `font-serif` Instrument Serif for statements, `font-pixel` Pixelify Sans for the hero title (needs ligatures off, or "fi" renders as one glyph), `font-sans`/`font-mono` Geist from `app/fonts/`.
- `components/TreeMark.tsx` is the 16x16 pixel tree as inline SVG; it uses the same grid as the favicons (`app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`). Change both together. `components/Trie.tsx` is the hand-placed SVG trie on the home page.
- Path alias: `@/*` maps to the repo root.
