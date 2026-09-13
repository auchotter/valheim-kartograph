import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MapLayer, type BiomeStroke, type Path } from '../shared/domain.ts';
import {
  distanceToPath,
  distanceToPolyline,
  distanceToSegment,
  hitTestPath,
  midpoint,
  quadraticBezierPoint,
  replacePathControlPoint,
} from '../client/src/lib/pathGeometry.ts';
import {
  dottedPathVisualStyle,
  pathColorForVisibleBiome,
  PATH_DARK_COLOR,
  PATH_DOT_RADIUS_CSS,
  PATH_DOT_SPACING_CSS,
  PATH_LIGHT_COLOR,
} from '../client/src/lib/pathVisualStyle.ts';
import { resolveVisibleBiomeAtPoint } from '../client/src/lib/terrainVisibility.ts';
import { initialPointerGesture } from '../client/src/lib/pointerGesture.ts';

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

for (const zoom of [0.1, 0.5, 1, 4, 8]) {
  const style = dottedPathVisualStyle(zoom);
  assertClose(style.radiusWorld * zoom, PATH_DOT_RADIUS_CSS);
  assertClose(style.spacingWorld * zoom, PATH_DOT_SPACING_CSS);
}

assert.equal(pathColorForVisibleBiome(null), PATH_DARK_COLOR);
assert.equal(pathColorForVisibleBiome('mountains'), PATH_DARK_COLOR);
assert.equal(pathColorForVisibleBiome('ocean'), PATH_DARK_COLOR);
for (const biome of ['meadows', 'black_forest', 'swamp', 'plains', 'mistlands', 'ashlands', 'lava', 'deep_north'] as const) {
  assert.equal(pathColorForVisibleBiome(biome), PATH_LIGHT_COLOR);
}

const terrainHistory: BiomeStroke[] = [
  stroke({ orderKey: 1, mode: 'paint', biome: 'meadows' }),
  stroke({ orderKey: 2, mode: 'paint', biome: 'swamp' }),
  stroke({ orderKey: 3, mode: 'erase', biome: null }),
  stroke({ orderKey: 4, mode: 'paint', biome: 'ashlands', points: [[0, 0]] }),
];
assert.equal(resolveVisibleBiomeAtPoint(terrainHistory, [75, 0]), null, 'erase should expose parchment');
assert.equal(resolveVisibleBiomeAtPoint(terrainHistory, [0, 0]), 'ashlands', 'later paint should win after erase');
assert.equal(resolveVisibleBiomeAtPoint(terrainHistory, [1000, 1000]), null, 'unpainted terrain is parchment');

for (const tool of ['biome_brush', 'eraser', 'path', 'marker', 'select'] as const) {
  assert.equal(
    initialPointerGesture({ button: 0, spaceHeld: true, tool, markerPlacementArmed: true, pathCreationArmed: true }),
    'pan',
    `Space must pan before ${tool}`,
  );
  assert.equal(
    initialPointerGesture({ button: 1, spaceHeld: false, tool, markerPlacementArmed: true, pathCreationArmed: true }),
    'pan',
    `middle mouse must pan before ${tool}`,
  );
}
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'biome_brush', markerPlacementArmed: false, pathCreationArmed: false }), 'biome-draw');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'eraser', markerPlacementArmed: false, pathCreationArmed: false }), 'erase');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'path', markerPlacementArmed: false, pathCreationArmed: true }), 'path-draw');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'path', markerPlacementArmed: false, pathCreationArmed: false }), 'select');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'marker', markerPlacementArmed: true, pathCreationArmed: false }), 'marker-place');

const rendererSource = readFileSync(
  new URL('../client/src/components/map/PixiMapRenderer.ts', import.meta.url),
  'utf8',
);
const dottedPathStart = rendererSource.indexOf('function drawDottedPath');
const strokeStart = rendererSource.indexOf('function createStrokeRenderable', dottedPathStart);
assert.notEqual(dottedPathStart, -1);
assert.notEqual(strokeStart, -1);
const dottedPathSource = rendererSource.slice(dottedPathStart, strokeStart);
assert.match(dottedPathSource, /resolveVisibleBiomeAtPointInOrder/);
assert.match(dottedPathSource, /pathColorForVisibleBiome/);
assert.match(dottedPathSource, /radiusWorld/);
assert.doesNotMatch(dottedPathSource, /HALO|halo|outline|Filter|RenderTexture/);
assert.doesNotMatch(dottedPathSource, /Filter|RenderTexture/);
assert.match(canvasSourceForGestures(), /activePointerGestureRef/);
assert.match(canvasSourceForGestures(), /cancelActivePointerGesture/);
assert.match(canvasSourceForGestures(), /onToolChange\('pan'\)/);
assert.match(canvasSourceForGestures(), /pathCreationArmedRef/);
assert.match(canvasSourceForGestures(), /drawing\.geometryType === 'freehand'/);
assert.match(canvasSourceForGestures(), /selectPath\(id\)/);
assert.match(canvasSourceForGestures(), /pathCreationArmedRef\.current = false/);
assert.match(canvasSourceForGestures(), /if \(currentTool === 'path'\)/);
assert.match(canvasSourceForGestures(), /selectPath\(null\);[\s\S]*onToolChange\('pan'\)/);

console.log('Path geometry and hit-testing verification passed');

function stroke(overrides: Partial<BiomeStroke>): BiomeStroke {
  const base = {
    id: crypto.randomUUID(),
    mapId: 'terrain-map',
    objectType: 'biome_stroke' as const,
    layer: MapLayer.Terrain,
    orderKey: 1,
    objectVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    minX: -100,
    minY: -100,
    maxX: 100,
    maxY: 100,
    mode: 'paint' as const,
    biome: 'meadows' as const,
    brushWidth: 100,
    points: [[-50, 0], [50, 0]],
  };
  return { ...base, ...overrides } as BiomeStroke;
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to equal ${expected}`);
}

function canvasSourceForGestures(): string {
  return readFileSync(new URL('../client/src/components/map/MapCanvas.tsx', import.meta.url), 'utf8');
}
