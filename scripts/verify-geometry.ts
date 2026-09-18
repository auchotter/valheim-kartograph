import assert from 'node:assert/strict';
import { createOptimisticBiomeStroke } from '../client/src/lib/biomeStroke.ts';
import { BIOMES, biomeStyle } from '../client/src/lib/biomeStyles.ts';
import type { Biome } from '../shared/domain.ts';
import { worldToScreen } from '../client/src/lib/camera.ts';
import { chooseGridSpacing } from '../client/src/lib/grid.ts';
import {
  shouldSamplePoint,
  simplifyStrokePoints,
  strokeBoundingBox,
  strokeSampleDistance,
} from '../client/src/lib/strokeGeometry.ts';

const width = 120;
assert.equal(BIOMES.length, 10);
assert.deepEqual(BIOMES, [
  'ocean',
  'meadows',
  'black_forest',
  'swamp',
  'mountains',
  'plains',
  'mistlands',
  'ashlands',
  'lava',
  'deep_north',
]);
for (const biome of BIOMES) {
  assert.match(biomeStyle(biome).baseHex, /^#[0-9A-F]{6}$/);
  assert.match(biomeStyle(biome).markHex, /^#[0-9A-F]{6}$/);
}

const lavaBiome: Biome = 'lava';
assert.equal(lavaBiome, 'lava');

const sampled: [number, number][] = [[0, 0]];
for (let x = 0.25; x <= 240; x += 0.25) {
  const point: [number, number] = [x, Math.sin(x / 30) * 8];
  if (shouldSamplePoint(sampled, point, strokeSampleDistance(width))) {
    sampled.push(point);
  }
}
assert.ok(sampled.length < 100, 'sampling should avoid a point per pointer event');

const simplified = simplifyStrokePoints(
  [
    [0, 0],
    [10, 0.2],
    [20, -0.1],
    [30, 0],
  ],
  1,
);
assert.deepEqual(simplified, [
  [0, 0],
  [30, 0],
]);

assert.deepEqual(strokeBoundingBox([[10, 20]], width), {
  minX: -50,
  minY: -40,
  maxX: 70,
  maxY: 80,
});

const paint = createOptimisticBiomeStroke({
  mapId: 'test-map',
  id: 'optimistic-paint',
  mode: 'paint',
  biome: 'black_forest',
  brushWidth: width,
  points: [[-20.5, 40.25]],
});
assert.equal(paint.layer, 0);
assert.equal(paint.mode, 'paint');
assert.equal(paint.biome, 'black_forest');
assert.equal(paint.brushWidth, width);
assert.equal(paint.objectVersion, 0);

const erase = createOptimisticBiomeStroke({
  mapId: 'test-map',
  id: 'optimistic-erase',
  mode: 'erase',
  biome: null,
  brushWidth: width,
  points: [[0, 0]],
});
assert.equal(erase.mode, 'erase');
assert.equal(erase.biome, null);

const zoomedScreenDiameter =
  worldToScreen([width / 2, 0], { cameraX: 0, cameraY: 0, zoom: 2.5 }, { width: 1000, height: 800 })
    .x -
  worldToScreen([-width / 2, 0], { cameraX: 0, cameraY: 0, zoom: 2.5 }, { width: 1000, height: 800 })
    .x;
assert.equal(zoomedScreenDiameter, width * 2.5);

for (const zoom of [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8]) {
  const screenSpacing = chooseGridSpacing(zoom) * zoom;
  assert.ok(screenSpacing >= 60 && screenSpacing <= 120, 'grid lines should remain readable');
}

// The former fallback varied the world interval continuously through the
// 27–31% camera range and then snapped at 30%. LOD spacing must remain fixed
// over that range while still staying in the intended readable band.
assert.deepEqual(
  [0.27, 0.28, 0.29, 0.30, 0.31].map((zoom) => chooseGridSpacing(zoom)),
  [250, 250, 250, 250, 250],
);
for (const zoom of [0.27, 0.28, 0.29, 0.30, 0.31]) {
  const screenSpacing = chooseGridSpacing(zoom) * zoom;
  assert.ok(screenSpacing >= 60 && screenSpacing <= 120, `grid spacing at ${zoom} remains readable`);
}

const severalHundred = Array.from({ length: 500 }, (_, index) =>
  createOptimisticBiomeStroke({
    mapId: 'test-map',
    id: `optimistic-${index}`,
    mode: 'paint',
    biome: 'meadows',
    brushWidth: 40,
    points: [[index, -index]],
  }),
);
assert.equal(severalHundred.length, 500);

console.log('Biome geometry and optimistic-stroke verification passed');
