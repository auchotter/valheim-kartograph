import type { BoundingBox, WorldPoint } from '../../../shared/domain';

const MIN_SAMPLE_DISTANCE = 2;
const MAX_SAMPLE_DISTANCE = 12;

export function strokeSampleDistance(brushWidth: number): number {
  return Math.max(MIN_SAMPLE_DISTANCE, Math.min(MAX_SAMPLE_DISTANCE, brushWidth * 0.08));
}

export function shouldSamplePoint(
  points: readonly WorldPoint[],
  candidate: WorldPoint,
  minimumDistance: number,
): boolean {
  const previous = points.at(-1);
  if (previous === undefined) {
    return true;
  }

  const deltaX = candidate[0] - previous[0];
  const deltaY = candidate[1] - previous[1];
  return deltaX * deltaX + deltaY * deltaY >= minimumDistance * minimumDistance;
}

/** Ramer-Douglas-Peucker simplification for sampled freehand geometry. */
export function simplifyStrokePoints(
  points: readonly WorldPoint[],
  tolerance: number,
): WorldPoint[] {
  if (points.length <= 2 || tolerance <= 0) {
    return [...points];
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  simplifySegment(points, 0, points.length - 1, tolerance * tolerance, keep);

  return points.filter((_, index) => keep[index] === 1);
}

export function strokeBoundingBox(
  points: readonly WorldPoint[],
  brushWidth: number,
): BoundingBox {
  const radius = brushWidth / 2;
  let minX = points[0]?.[0];
  let minY = points[0]?.[1];
  let maxX = minX;
  let maxY = minY;

  if (minX === undefined || minY === undefined) {
    throw new Error('A stroke needs at least one point.');
  }

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    minX: minX - radius,
    minY: minY - radius,
    maxX: maxX + radius,
    maxY: maxY + radius,
  };
}

function simplifySegment(
  points: readonly WorldPoint[],
  startIndex: number,
  endIndex: number,
  toleranceSquared: number,
  keep: Uint8Array,
): void {
  const start = points[startIndex];
  const end = points[endIndex];
  let farthestDistance = 0;
  let farthestIndex = -1;

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const distance = squaredDistanceToSegment(points[index], start, end);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }

  if (farthestIndex !== -1 && farthestDistance > toleranceSquared) {
    keep[farthestIndex] = 1;
    simplifySegment(points, startIndex, farthestIndex, toleranceSquared, keep);
    simplifySegment(points, farthestIndex, endIndex, toleranceSquared, keep);
  }
}

function squaredDistanceToSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    const x = point[0] - start[0];
    const y = point[1] - start[1];
    return x * x + y * y;
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared),
  );
  const closestX = start[0] + projection * deltaX;
  const closestY = start[1] + projection * deltaY;
  const x = point[0] - closestX;
  const y = point[1] - closestY;
  return x * x + y * y;
}
