// Same 16x16 pixel tree as the favicon (app/favicon.ico)
const GRID = [
  "....####.##.....",
  "..##########....",
  ".####.#######...",
  ".###########.##.",
  ".##############.",
  "..#######.#####.",
  "...###########..",
  ".....######.....",
  ".......##.......",
  ".......##.......",
  ".....######.....",
  "....#.#..#.#....",
  "...#..#..#..#...",
  "...#..#..#..#...",
];

const PIXELS = GRID.flatMap((row, y) =>
  row.split("").flatMap((c, x) => (c === "#" ? [[x, y + 1]] : []))
);

export default function TreeMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {PIXELS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  );
}
