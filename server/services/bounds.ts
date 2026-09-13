import type { BoundingBox, WorldPoint } from '../../shared/domain.js';

export function pointBounds(x: number, y: number): BoundingBox {
  return { minX: x, minY: y, maxX: x, maxY: y };
}

export function strokedPointBounds(points: readonly WorldPoint[], width: number): BoundingBox {
  const radius = width / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + radius);
  }

  return { minX, minY, maxX, maxY };
}
