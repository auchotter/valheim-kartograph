import assert from 'node:assert/strict';
import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAtScreenPoint,
} from '../client/src/lib/camera.ts';
import {
  CAMERA_VIEW_STORAGE_KEY,
  CAMERA_VIEW_WRITE_DEBOUNCE_MS,
  parseCameraViewRecord,
  readCameraViewFromStorage,
  writeCameraViewToStorage,
} from '../client/src/lib/cameraViewPersistence.ts';
import { readFileSync } from 'node:fs';

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
assert.equal(MIN_ZOOM, 0.05);
assert.equal(MAX_ZOOM, 8);
assert.equal(zoomAtScreenPoint(camera, cursor, viewport, 0.049).zoom, 0.05);
assert.equal(zoomAtScreenPoint(camera, cursor, viewport, 0.05).zoom, 0.05);
assert.equal(zoomAtScreenPoint(camera, cursor, viewport, Infinity).zoom, MAX_ZOOM);
assert.equal(DEFAULT_CAMERA.zoom, 1);

const valid = parseCameraViewRecord(
  JSON.stringify({ version: 1, mapId: 'A', cameraX: 1234, cameraY: -567, zoom: 2.5 }),
  'A',
);
assert.deepEqual(valid, { version: 1, mapId: 'A', cameraX: 1234, cameraY: -567, zoom: 2.5 });
assert.equal(parseCameraViewRecord(JSON.stringify({ version: 1, mapId: 'A', cameraX: 1, cameraY: 2, zoom: 3 }), 'B'), null);
assert.equal(parseCameraViewRecord('{not-json', 'A'), null);
assert.equal(parseCameraViewRecord(JSON.stringify({ version: 1, mapId: 'A', cameraX: NaN, cameraY: 2, zoom: 1 }), 'A'), null);
assert.equal(parseCameraViewRecord(JSON.stringify({ version: 1, mapId: 'A', cameraX: 1, cameraY: 2, zoom: Infinity }), 'A'), null);
assert.equal(parseCameraViewRecord(JSON.stringify({ version: 1, mapId: 'A', cameraX: 1, cameraY: 2, zoom: 99 }), 'A')?.zoom, MAX_ZOOM);
assert.equal(parseCameraViewRecord(JSON.stringify({ version: 1, mapId: 'A', cameraX: 1, cameraY: 2, zoom: 0.05 }), 'A')?.zoom, 0.05);
assert.equal(parseCameraViewRecord(JSON.stringify({ version: 1, mapId: 'A', cameraX: 1, cameraY: 2, zoom: 0.01 }), 'A')?.zoom, MIN_ZOOM);

const storage = new Map<string, string>();
writeCameraViewToStorage({
  setItem(key, value) { storage.set(key, value); },
  getItem() { return storage.get(CAMERA_VIEW_STORAGE_KEY) ?? null; },
}, { version: 1, mapId: 'A', cameraX: 10, cameraY: 20, zoom: 1 });
assert.equal(storage.has(CAMERA_VIEW_STORAGE_KEY), true);

const oldSession = new Map<string, string>([
  [CAMERA_VIEW_STORAGE_KEY, JSON.stringify({ version: 1, mapId: 'A', cameraX: 1234, cameraY: -567, zoom: 2.5 })],
]);
const migratedLocal = new Map<string, string>();
assert.deepEqual(
  readCameraViewFromStorage(mapStorage(migratedLocal), 'A', mapStorage(oldSession)),
  { version: 1, mapId: 'A', cameraX: 1234, cameraY: -567, zoom: 2.5 },
);
assert.equal(migratedLocal.has(CAMERA_VIEW_STORAGE_KEY), true);

// A later tab/session uses the durable record even with an empty session store.
assert.deepEqual(
  readCameraViewFromStorage(mapStorage(migratedLocal), 'A', mapStorage(new Map())),
  { version: 1, mapId: 'A', cameraX: 1234, cameraY: -567, zoom: 2.5 },
);

// A local record wins over a stale legacy session value, and map matching remains enforced.
const localWins = new Map<string, string>([
  [CAMERA_VIEW_STORAGE_KEY, JSON.stringify({ version: 1, mapId: 'A', cameraX: 7, cameraY: 8, zoom: 1 })],
]);
const staleSession = new Map<string, string>([
  [CAMERA_VIEW_STORAGE_KEY, JSON.stringify({ version: 1, mapId: 'A', cameraX: 99, cameraY: 100, zoom: 2 })],
]);
assert.deepEqual(readCameraViewFromStorage(mapStorage(localWins), 'A', mapStorage(staleSession))?.cameraX, 7);
assert.equal(readCameraViewFromStorage(mapStorage(localWins), 'B', mapStorage(staleSession)), null);

const sessionSource = readFileSync(new URL('../client/src/state/useMapSession.ts', import.meta.url), 'utf8');
const persistenceSource = readFileSync(new URL('../client/src/lib/cameraViewPersistence.ts', import.meta.url), 'utf8');
assert.equal(CAMERA_VIEW_WRITE_DEBOUNCE_MS, 300);
assert.match(sessionSource, /latestCameraViewRef/);
assert.match(sessionSource, /window\.setTimeout/);
assert.match(sessionSource, /pagehide/);
assert.doesNotMatch(sessionSource, /setInterval|requestAnimationFrame/);
assert.match(persistenceSource, /window\.localStorage/);
assert.match(persistenceSource, /safeSessionStorage/); // legacy migration only

function mapStorage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

console.log('Camera coordinate and cursor-centred zoom verification passed');
