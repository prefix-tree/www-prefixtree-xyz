# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Site for Prefix Tree ([prefixtree.xyz](https://prefixtree.xyz)). Next.js 14 App Router + Tailwind, hosted on Cloudflare Pages.

**Direction:** the site's overall purpose is crafting different cool projects, run by Bohdan Snisar and Pavel Grachev-Mousset. It is moving away from the earlier "applied-AI consultancy" pitch, so much of the existing content (consultancy copy) is expected to be dropped. Don't extend the old consultancy framing. The package was previously named "Overvu Solutions" (`name` in package.json still says so).

## Commands

Use pnpm (declared in `packageManager` in package.json). The stray `package-lock.json` is not the source of truth.

- `pnpm dev` — local dev server
- `pnpm build` — production build (also the only real check: type errors and lint fail the build)
- `pnpm lint` — `next lint` (extends `next/core-web-vitals` + `next/typescript`)

There is no test suite.

## Architecture

- `app/sitemap.ts` and `app/robots.ts` hardcode `https://prefixtree.xyz`; new pages must be added to the sitemap manually.
- `app/layout.tsx` holds the shared header/footer, site-wide metadata/OpenGraph, contact email, and the Libre Baskerville font (via `next/font/google`).
- Visual direction: "digital tree" aesthetic, loosely modelled on generalintelligencecompany.com's layout (full-height hero, floating glass nav, glass card, striped bands, airy serif statements) but with general, studio-wide copy rather than one product. Motifs: the pixel-art tree (`public/hero.png`), pixel grid, circuit-trace stripes, trie diagrams, `├──` tree-output labels.
- Fonts (wired in `app/layout.tsx` and `tailwind.config.ts`): `font-serif` Instrument Serif for statements, `font-pixel` Pixelify Sans for the hero title (needs ligatures off, or "fi" renders as one glyph), `font-sans`/`font-mono` Geist from `app/fonts/`.
- `components/TreeMark.tsx` is the 16x16 pixel tree as inline SVG; it uses the same grid as the favicons (`app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`). Change both together. `components/Trie.tsx` is the hand-placed SVG trie on the home page.
- Path alias: `@/*` maps to the repo root.
