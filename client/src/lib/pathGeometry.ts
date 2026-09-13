import type { Path, PathGeometryType, WorldPoint } from '../../../shared/domain';

export const DEFAULT_PATH_STROKE_WIDTH = 10;

const MIN_SAMPLE_DISTANCE = 2;
const MAX_SAMPLE_DISTANCE = 10;
const CURVE_HIT_TEST_SEGMENTS = 32;

export interface CompletedPathGesture {
  id: string;
  geometryType: PathGeometryType;
  strokeWidth: number;
  points: WorldPoint[];
}

/** Sampling is deliberately independent from brush geometry and screen pixels. */
export function pathSampleDistance(strokeWidth: number): number {
  return Math.max(MIN_SAMPLE_DISTANCE, Math.min(MAX_SAMPLE_DISTANCE, strokeWidth * 0.8));
}

export function quadraticBezierPoint(
  start: WorldPoint,
  control: WorldPoint,
  end: WorldPoint,
  t: number,
): WorldPoint {
  const clamped = Math.max(0, Math.min(1, t));
  const inverse = 1 - clamped;
  return [
    inverse * inverse * start[0] + 2 * inverse * clamped * control[0] + clamped * clamped * end[0],
    inverse * inverse * start[1] + 2 * inverse * clamped * control[1] + clamped * clamped * end[1],
  ];
}

export function quadraticBezierPolyline(
  start: WorldPoint,
  control: WorldPoint,
  end: WorldPoint,
  segments = CURVE_HIT_TEST_SEGMENTS,
): WorldPoint[] {
  const count = Math.max(2, Math.floor(segments));
  return Array.from({ length: count + 1 }, (_, index) =>
    quadraticBezierPoint(start, control, end, index / count),
  );
}

/** Returns geometry suitable for drawing and hit testing. */
type PathGeometry = Pick<Path, 'geometryType'> & { points: readonly WorldPoint[] };

export function pathPolyline(path: PathGeometry): WorldPoint[] {
  if (path.geometryType !== 'curve') {
    return [...path.points];
  }

  const [start, control, end] = path.points;
  if (start === undefined || control === undefined || end === undefined) {
    return [];
  }
  return quadraticBezierPolyline(start, control, end);
}

export function midpoint(start: WorldPoint, end: WorldPoint): WorldPoint {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
}

export function distanceToSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  const x = end[0] - start[0];
  const y = end[1] - start[1];
  const lengthSquared = x * x + y * y;
  if (lengthSquared === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }

  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * x + (point[1] - start[1]) * y) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + x * t), point[1] - (start[1] + y * t));
}

export function distanceToPolyline(point: WorldPoint, points: readonly WorldPoint[]): number {
  if (points.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (points.length === 1) {
    return Math.hypot(point[0] - points[0][0], point[1] - points[0][1]);
  }

  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, points[index - 1], points[index]));
  }
  return distance;
}

export function distanceToPath(point: WorldPoint, path: PathGeometry): number {
  return distanceToPolyline(point, pathPolyline(path));
}

/** Later paths win, matching Paths-layer rendering order. */
export function hitTestPath(
  paths: readonly Path[],
  worldPoint: WorldPoint,
  toleranceWorld: number,
): Path | null {
  const ordered = [...paths].sort((left, right) => right.orderKey - left.orderKey);
  return ordered.find((path) => distanceToPath(worldPoint, path) <= toleranceWorld) ?? null;
}

export function replacePathControlPoint(path: Path, pointIndex: number, point: WorldPoint): Path {
  if (path.geometryType === 'freehand' || pointIndex < 0 || pointIndex >= path.points.length) {
    return path;
  }
  const points = path.points.map((candidate, index) => (index === pointIndex ? point : candidate));
  return { ...path, points };
}
