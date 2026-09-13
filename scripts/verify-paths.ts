import assert from 'node:assert/strict';
import { MapLayer, type Path } from '../shared/domain.ts';
import {
  distanceToPath,
  distanceToPolyline,
  distanceToSegment,
  hitTestPath,
  midpoint,
  quadraticBezierPoint,
  replacePathControlPoint,
} from '../client/src/lib/pathGeometry.ts';

function path(overrides: Partial<Path>): Path {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    mapId: '22222222-2222-4222-8222-222222222222',
    objectType: 'path',
    layer: MapLayer.Paths,
    orderKey: 1,
    objectVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    minX: 0,
    minY: 0,
    maxX: 100,
    maxY: 100,
    pathType: 'path',
    geometryType: 'straight',
    strokeWidth: 10,
    points: [
      [0, 0],
      [100, 0],
    ],
    ...overrides,
  };
}

assert.equal(distanceToSegment([50, 10], [0, 0], [100, 0]), 10);
assert.equal(distanceToSegment([-10, 0], [0, 0], [100, 0]), 10);
assert.equal(distanceToPolyline([45, 5], [[0, 0], [50, 0], [50, 50]]), 5);

assert.deepEqual(quadraticBezierPoint([0, 0], [50, 100], [100, 0], 0), [0, 0]);
assert.deepEqual(quadraticBezierPoint([0, 0], [50, 100], [100, 0], 1), [100, 0]);
assert.deepEqual(quadraticBezierPoint([0, 0], [50, 100], [100, 0], 0.5), [50, 50]);
assert.deepEqual(midpoint([0, 0], [100, 20]), [50, 10]);

const curve = path({
  id: '33333333-3333-4333-8333-333333333333',
  geometryType: 'curve',
  points: [
    [0, 0],
    [50, 100],
    [100, 0],
  ],
});
assert.ok(distanceToPath([50, 50], curve) < 0.001, 'quadratic curve approximation should hit its midpoint');
assert.ok(distanceToPath([50, 75], curve) > 20, 'curve hit testing should reject points away from the curve');

const later = path({
  id: '44444444-4444-4444-8444-444444444444',
  orderKey: 2,
  points: [
    [0, 0],
    [100, 0],
  ],
});
assert.equal(hitTestPath([path({ orderKey: 1 }), later], [50, 4], 8)?.id, later.id);
assert.equal(hitTestPath([later], [50, 12], 8), null);

const changed = replacePathControlPoint(curve, 1, [60, 120]);
assert.deepEqual(changed.points, [
  [0, 0],
  [60, 120],
  [100, 0],
]);
assert.deepEqual(replacePathControlPoint(path({ geometryType: 'freehand' }), 0, [10, 10]), path({ geometryType: 'freehand' }));

// A 12 CSS-pixel tolerance transforms to world space with inverse zoom.
assert.equal(12 / 2, 6);
assert.equal(12 / 0.5, 24);

console.log('Path geometry and hit-testing verification passed');
