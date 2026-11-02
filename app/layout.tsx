import type { Metadata } from "next";
import { Instrument_Serif, Pixelify_Sans } from "next/font/google";
import localFont from "next/font/local";
import Link from "next/link";

import TreeMark from "@/components/TreeMark";

import "./globals.css";

const serif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

const pixel = Pixelify_Sans({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-pixel",
});

const sans = localFont({
  src: "./fonts/GeistVF.woff",
  weight: "100 900",
  variable: "--font-sans",
});

const mono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  weight: "100 900",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Prefix Tree",
  description: "We craft products.",
  openGraph: {
    title: "Prefix Tree",
    description: "We craft products.",
    url: "https://prefixtree.xyz",
    siteName: "Prefix Tree",
    locale: "en_US",
    type: "website",
  },
};

const email = "partners@prefixtree.xyz";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${serif.variable} ${pixel.variable} ${sans.variable} ${mono.variable} font-sans antialiased overflow-x-hidden`}
      >
        {/* ---------- FLOATING NAV ---------- */}
        <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <nav className="flex items-center gap-1 rounded-xl border border-white/70 bg-white/60 p-1.5 text-sm text-neutral-800 shadow-sm backdrop-blur-md">
            <Link
              href="/"
              aria-label="Prefix Tree home"
              className="rounded-lg px-2 py-1.5 hover:bg-black/5"
            >
              <TreeMark className="h-5 w-5" />
            </Link>
            <Link href="/#about" className="rounded-lg px-3 py-1.5 hover:bg-black/5">
              About
            </Link>
            <a
              href={`mailto:${email}`}
              className="ml-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-700"
            >
              Get in touch
            </a>
          </nav>
        </header>

        <main>{children}</main>

        {/* ---------- FOOTER ---------- */}
        <footer className="mt-24">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-neutral-600 sm:px-12">
            <div className="flex gap-5">
              <Link href="/" className="hover:text-neutral-900">
                Home
              </Link>
              <Link href="/privacy" className="hover:text-neutral-900">
                Privacy
              </Link>
              <a href={`mailto:${email}`} className="hover:text-neutral-900">
                {email}
              </a>
            </div>
            <span>© {new Date().getFullYear()} Prefix Tree</span>
          </div>
          <div className="stripes" />
        </footer>
      </body>
    </html>
  );
}
