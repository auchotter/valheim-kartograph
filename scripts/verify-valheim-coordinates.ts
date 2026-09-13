import assert from 'node:assert/strict';
import { screenToWorld, worldToScreen } from '../client/src/lib/camera.ts';
import {
  mapToValheimCoordinates,
  parseValheimCoordinate,
  valheimToMapCoordinates,
} from '../client/src/lib/valheimCoordinates.ts';

const epsilon = 1e-10;
const origin = valheimToMapCoordinates(0, 0);
assert.deepEqual(origin, { x: 0, y: 0 });
assert.deepEqual(valheimToMapCoordinates(1000, 0), { x: 1000, y: 0 });
assert.deepEqual(valheimToMapCoordinates(-1000, 0), { x: -1000, y: 0 });
assert.deepEqual(valheimToMapCoordinates(0, 1000), { x: 0, y: -1000 });
assert.deepEqual(valheimToMapCoordinates(0, -1000), { x: 0, y: 1000 });

for (const [x, z] of [[0, 0], [1250.5, -843.25], [-0.75, 10000.125]]) {
  const map = valheimToMapCoordinates(x, z);
  const roundTrip = mapToValheimCoordinates(map.x, map.y);
  assert.ok(Math.abs(roundTrip.x - x) < epsilon);
  assert.ok(Math.abs(roundTrip.z - z) < epsilon);
}

assert.equal(parseValheimCoordinate(' -843.25 '), -843.25);
assert.equal(parseValheimCoordinate('0'), 0);
assert.equal(parseValheimCoordinate(''), null);
assert.equal(parseValheimCoordinate('Infinity'), null);
assert.equal(parseValheimCoordinate('not-a-number'), null);

const viewport = { width: 1000, height: 800 };
for (const zoom of [0.1, 1, 8]) {
  const map = valheimToMapCoordinates(1234, -567);
  const camera = { cameraX: map.x, cameraY: map.y, zoom };
  const screen = worldToScreen([map.x, map.y], camera, viewport);
  assert.ok(Math.abs(screen.x - 500) < epsilon);
  assert.ok(Math.abs(screen.y - 400) < epsilon);
  const world = screenToWorld(screen, camera, viewport);
  assert.ok(Math.abs(world[0] - map.x) < epsilon);
  assert.ok(Math.abs(world[1] - map.y) < epsilon);
}

console.log('Valheim X/Z coordinate conversion and camera-centering verification passed');
