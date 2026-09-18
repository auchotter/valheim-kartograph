import type { WorldPoint } from '../../../shared/domain';

export interface PathViewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
