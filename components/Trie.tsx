// Radix trie of four words sharing the root "pr", drawn as circuit traces.
const edges = [
  { d: "M14 40 H106", label: "pr", lx: 60, ly: 31 },
  { d: "M114 40 H246", label: "efix", lx: 180, ly: 31 },
  { d: "M110 44 V112 Q110 120 118 120 H196", label: "o", lx: 155, ly: 111 },
  { d: "M204 120 H336", label: "duct", lx: 270, ly: 111 },
  { d: "M200 124 V162 Q200 170 208 170 H336", label: "totype", lx: 270, ly: 161 },
  { d: "M200 174 V212 Q200 220 208 220 H336", label: "ject", lx: 270, ly: 211 },
];

const nodes = [
  { x: 10, y: 40 },
  { x: 110, y: 40 },
  { x: 250, y: 40, word: "prefix" },
  { x: 200, y: 120 },
  { x: 340, y: 120, word: "product" },
  { x: 340, y: 170, word: "prototype" },
  { x: 340, y: 220, word: "project" },
];

export default function Trie() {
  return (
    <svg
      viewBox="0 0 480 240"
      className="h-auto w-full font-mono text-[13px]"
      role="img"
      aria-label="A prefix tree: prefix, product, prototype and project all branch from the root pr"
    >
      <g fill="none" stroke="#9db5ac" strokeWidth="1.5">
        {edges.map((e) => (
          <path key={e.d} d={e.d} />
        ))}
      </g>
      <g fill="#525252" textAnchor="middle">
        {edges.map((e) => (
          <text key={e.label} x={e.lx} y={e.ly}>
            {e.label}
          </text>
        ))}
      </g>
      {nodes.map((n) => (
        <g key={`${n.x}-${n.y}`}>
          <rect
            x={n.x - 4}
            y={n.y - 4}
            width="8"
            height="8"
            shapeRendering="crispEdges"
            fill={n.word ? "#171717" : "#fdfdfb"}
            stroke="#171717"
            strokeWidth="1.5"
          />
          {n.word && (
            <text x={n.x + 14} y={n.y + 4.5} fill="#a3a3a3">
              {n.word}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
