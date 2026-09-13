import assert from 'node:assert/strict';
import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAtScreenPoint,
} from '../client/src/lib/camera.ts';

const epsilon = 1e-10;
const camera = { cameraX: 123.25, cameraY: -456.5, zoom: 1.75 };
const viewport = { width: 1512, height: 982 };
const worldPoint: readonly [number, number] = [-87.125, 908.75];
const screenPoint = worldToScreen(worldPoint, camera, viewport);
const roundTrip = screenToWorld(screenPoint, camera, viewport);

assert.ok(Math.abs(roundTrip[0] - worldPoint[0]) < epsilon);
assert.ok(Math.abs(roundTrip[1] - worldPoint[1]) < epsilon);

const cursor = { x: 912.5, y: 187.75 };
const beforeZoom = screenToWorld(cursor, camera, viewport);
const zoomed = zoomAtScreenPoint(camera, cursor, viewport, 3.4);
const afterZoom = screenToWorld(cursor, zoomed, viewport);

assert.ok(Math.abs(afterZoom[0] - beforeZoom[0]) < epsilon);
assert.ok(Math.abs(afterZoom[1] - beforeZoom[1]) < epsilon);
assert.equal(zoomAtScreenPoint(camera, cursor, viewport, 0).zoom, MIN_ZOOM);
assert.equal(zoomAtScreenPoint(camera, cursor, viewport, Infinity).zoom, MAX_ZOOM);
assert.equal(DEFAULT_CAMERA.zoom, 1);

console.log('Camera coordinate and cursor-centred zoom verification passed');
