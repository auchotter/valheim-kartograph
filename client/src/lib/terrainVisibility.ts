import type { Biome, BiomeStroke, WorldPoint } from '../../../shared/domain';

/**
 * Resolves the semantic terrain result at one world-space point. This mirrors
 * chronological paint/erase compositing without reading back the GPU buffer.
 */
export function resolveVisibleBiomeAtPoint(
  strokes: readonly BiomeStroke[],
  point: WorldPoint,
): Biome | null {
  return resolveVisibleBiomeAtPointInOrder(orderTerrainStrokes(strokes), point);
}

/** Sort once when resolving several points, such as a dotted path. */
export function orderTerrainStrokes(strokes: readonly BiomeStroke[]): BiomeStroke[] {
  return [...strokes].sort(
    (left, right) => left.layer - right.layer || left.orderKey - right.orderKey,
  );
}

export function resolveVisibleBiomeAtPointInOrder(
  orderedStrokes: readonly BiomeStroke[],
  point: WorldPoint,
): Biome | null {
  let biome: Biome | null = null;

  for (const stroke of orderedStrokes) {
    if (stroke.deletedAt !== null) {
      continue;
    }
    if (pointIsInsideStroke(point, stroke)) {
      biome = stroke.mode === 'paint' ? stroke.biome : null;
    }
  }
  return biome;
}

/** Matches the round-cap/round-join semantic brush footprint. */
export function pointIsInsideStroke(point: WorldPoint, stroke: Pick<BiomeStroke, 'points' | 'brushWidth'>): boolean {
  const radius = stroke.brushWidth / 2;
  const radiusSquared = radius * radius;
  const points = stroke.points;
  if (points.length === 0) {
    return false;
  }
  if (points.length === 1) {
    return squaredDistance(point, points[0]) <= radiusSquared;
  }

  for (let index = 1; index < points.length; index += 1) {
    if (squaredDistanceToSegment(point, points[index - 1], points[index]) <= radiusSquared) {
      return true;
    }
  }
  return false;
}

function squaredDistance(point: WorldPoint, candidate: WorldPoint): number {
  const deltaX = point[0] - candidate[0];
  const deltaY = point[1] - candidate[1];
  return deltaX * deltaX + deltaY * deltaY;
}

function squaredDistanceToSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) {
    return squaredDistance(point, start);
  }
  const projection = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared),
  );
  return squaredDistance(point, [start[0] + projection * deltaX, start[1] + projection * deltaY]);
}
