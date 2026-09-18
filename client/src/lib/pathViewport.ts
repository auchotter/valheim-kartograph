import type { WorldPoint } from '../../../shared/domain';

export interface PathViewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Global phase, viewport-local work budget. Never cap the distance from the path origin. */
export function forEachVisiblePathDot(
  points: readonly WorldPoint[], spacing: number, viewport: PathViewport | undefined,
  budget: number, draw: (x: number, y: number) => void,
): number {
  let dots = 0;
  let distance = 0;
  let nextDotIndex = 0;
  const emit = (x: number, y: number) => {
    if (dots >= budget || (viewport && (x < viewport.minX || x > viewport.maxX || y < viewport.minY || y > viewport.maxY))) return;
    draw(x, y);
    dots++;
  };
  if (!Number.isFinite(spacing) || spacing <= 0 || points.length === 0) return 0;
  if (points.length === 1) { emit(...points[0]); return dots; }
  for (let i = 1; i < points.length && dots < budget; i++) {
    const start = points[i - 1], end = points[i];
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const last = Math.floor((distance + length) / spacing);
    const range = viewport ? visibleSegmentRange(start, end, viewport) : [0, 1];
    if (range !== null) {
      const firstVisible = Math.max(nextDotIndex, Math.ceil((distance + range[0] * length) / spacing));
      const lastVisible = Math.min(last, Math.floor((distance + range[1] * length) / spacing));
      for (let index = firstVisible; index <= lastVisible && dots < budget; index++) {
        const along = Math.max(0, index * spacing - distance) / length;
        emit(start[0] + dx * along, start[1] + dy * along);
      }
    }
    nextDotIndex = last + 1;
    distance += length;
  }
  // Preserve the visible endpoint of paths shorter than one dot spacing.
  if (distance < spacing) emit(...points.at(-1)!);
  return dots;
}

/** Clip work, not geometry: the returned fractions retain the path's dot phase. */
export function visibleSegmentRange(start: WorldPoint, end: WorldPoint, bounds: PathViewport): [number, number] | null {
  let first = 0;
  let last = 1;
  for (const [position, delta, minimum, maximum] of [
    [start[0], end[0] - start[0], bounds.minX, bounds.maxX],
    [start[1], end[1] - start[1], bounds.minY, bounds.maxY],
  ]) {
    if (delta === 0) {
      if (position < minimum || position > maximum) return null;
    } else {
      const a = (minimum - position) / delta;
      const b = (maximum - position) / delta;
      first = Math.max(first, Math.min(a, b));
      last = Math.min(last, Math.max(a, b));
      if (first > last) return null;
    }
  }
  return [first, last];
}
