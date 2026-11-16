import AsciiGarden from "@/components/AsciiGarden";
import TreeMark from "@/components/TreeMark";
import Trie from "@/components/Trie";

const email = "partners@prefixtree.xyz";

const notes = [
  {
    title: "small-team",
    body: "Two people, Bohdan and Pavel. Short loops from an idea to a working thing.",
  },
  {
    title: "many-branches",
    body: "Several products in different domains. The common root is how they are made.",
  },
  {
    title: "open-source",
    body: "Some branches are open-source projects: code anyone can read, use and build on.",
  },
  {
    title: "built-to-ship",
    body: "We would rather show a working product than a deck about one.",
  },
];

const projects = [
  {
    name: "cutcraft",
    kind: "open source",
    body: "Video editor as code. A model writes a TSX file of words and shots; CutCraft does the arithmetic, plays it in the browser, edits it and exports it.",
    href: "https://cutcraft.prefixtree.xyz/",
    host: "cutcraft.prefixtree.xyz",
  },
  {
    name: "deletion.info",
    kind: "public good",
    body: "A free public resource, open to everyone.",
    href: "https://deletion.info/",
    host: "deletion.info",
  },
];

export default function Home() {
  return (
    <>
      {/* ---------- HERO ---------- */}
      <section className="hero-garden relative flex min-h-[100svh] flex-col justify-between overflow-hidden">
        <AsciiGarden />

        <h1
          data-garden-clear
          className="relative z-10 mx-auto mt-24 font-pixel text-3xl [font-variant-ligatures:none] text-neutral-900 md:text-4xl"
        >
          Prefix Tree
        </h1>

        <div data-garden-ground className="min-h-[380px] flex-1 sm:hidden" />

        <div className="relative z-10 m-4 rounded-2xl border border-white/60 bg-white/50 p-6 shadow-sm backdrop-blur-md sm:absolute sm:bottom-10 sm:left-10 sm:m-0 sm:max-w-sm">
          <h2 className="font-serif text-4xl leading-none text-neutral-900">
            We grow software.
            <span className="cursor ml-1 inline-block h-[0.8em] w-[0.4em] translate-y-[0.05em] bg-neutral-900" />
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-neutral-700">
            Prefix Tree is Local Group Software Corp. We work on several
            products and open-source projects, each grown from one root.
          </p>
          <a
            href="#about"
            className="mt-5 inline-block text-sm text-neutral-900 underline underline-offset-4"
          >
            Get to know us →
          </a>
        </div>

        <p
          data-garden-clear
          className="absolute bottom-10 right-10 z-10 hidden max-w-[16ch] text-right font-mono text-xs text-neutral-600 sm:block"
        >
          Many projects, one root.
        </p>
      </section>

      <div className="stripes" />

      {/* ---------- ABOUT ---------- */}
      <section id="about" className="mx-auto max-w-5xl scroll-mt-24 px-6 py-32 sm:px-12">
        <p className="max-w-3xl font-serif text-4xl leading-tight text-neutral-900 md:text-5xl">
          The world is a big garden.{" "}
          <span className="text-neutral-400">
            We plant new trees in it: products and open-source projects that
            take root, grow, and turn out useful for people and good for
            society.
          </span>
        </p>

        <div className="mt-20 grid items-start gap-12 md:grid-cols-[1fr_1.3fr]">
          <div className="font-mono text-sm">
            <div className="text-neutral-500">prefix-tree/</div>
            {notes.map((n, i) => {
              const last = i === notes.length - 1;
              return (
                <div key={n.title}>
                  <div className="mt-1 text-neutral-900">
                    <span className="text-neutral-400">{last ? "└── " : "├── "}</span>
                    {n.title}
                  </div>
                  <p
                    className={`ml-[0.5ch] pb-3 pl-[3.5ch] font-sans text-sm leading-relaxed text-neutral-700 ${
                      last ? "" : "border-l border-neutral-300"
                    }`}
                  >
                    {n.body}
                  </p>
                </div>
              );
            })}
          </div>

          <figure>
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <Trie />
            </div>
            <figcaption className="mt-3 text-right font-mono text-xs text-neutral-400">
              Fig. 1 &nbsp; Four words, one root
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ---------- PROJECTS ---------- */}
      <section id="projects" className="mx-auto max-w-5xl scroll-mt-24 px-6 pb-24 sm:px-12">
        <h2 className="max-w-3xl font-serif text-4xl leading-tight text-neutral-900 md:text-5xl">
          What grows here.{" "}
          <span className="text-neutral-400">
            Products, open-source projects and public goods.
          </span>
        </h2>

        <div className="mt-12 font-mono text-sm">
          <div className="text-neutral-500">projects/</div>
          {projects.map((p, i) => {
            const last = i === projects.length - 1;
            return (
              <div key={p.name}>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-neutral-900">
                  <span>
                    <span className="text-neutral-400">{last ? "└── " : "├── "}</span>
                    {p.name}
                  </span>
                  <span className="rounded border border-neutral-300 px-1.5 text-xs text-neutral-500">
                    {p.kind}
                  </span>
                </div>
                <div
                  className={`ml-[0.5ch] pb-6 pl-[3.5ch] ${last ? "" : "border-l border-neutral-300"}`}
                >
                  <p className="max-w-xl font-sans text-sm leading-relaxed text-neutral-700">
                    {p.body}
                  </p>
                  <a
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs text-neutral-900 underline underline-offset-4"
                  >
                    {p.host} ↗
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="stripes" />

      {/* ---------- CLOSING ---------- */}
      <section className="px-6 pt-16 text-center">
        <TreeMark className="mx-auto h-8 w-8 text-neutral-900" />
        <h2 className="mt-6 font-serif text-4xl text-neutral-900 md:text-5xl">
          Have an idea worth building?
        </h2>
        <p className="mt-4 text-neutral-600">
          Write to us at{" "}
          <a href={`mailto:${email}`} className="text-neutral-900 underline underline-offset-4">
            {email}
          </a>
        </p>
      </section>
    </>
  );
}
