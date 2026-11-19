import type { SpreadRow } from './blindability';

// Preserve exact delta positions; move portraits vertically only to avoid overlap.
export function stackMatchups(rows: readonly SpreadRow[]) {
  const width = 600,
    left = 18,
    right = 582,
    top = 12,
    size = 18,
    gap = 3;
  const bound = Math.max(
    6,
    Math.ceil(Math.max(...rows.map((r) => Math.abs(r.delta))) + 0.5),
  );
  const x = (v: number) => left + ((v + bound) / (2 * bound)) * (right - left);
  const levels: number[][] = [],
    points: (SpreadRow & { cx: number; level: number })[] = [];
  for (const row of [...rows].sort(
    (a, b) => a.delta - b.delta || a.id - b.id,
  )) {
    const cx = x(row.delta);
    let level = levels.findIndex((xs) =>
      xs.every((px) => Math.abs(px - cx) >= size + gap),
    );
    if (level < 0) {
      level = levels.length;
      levels.push([]);
    }
    levels[level].push(cx);
    points.push({ ...row, cx, level });
  }
  const baseline = Math.max(235, levels.length * (size + gap) + 54),
    height = baseline + 49;
  return {
    points,
    width,
    left,
    right,
    top,
    size,
    gap,
    bound,
    baseline,
    height,
  };
}
