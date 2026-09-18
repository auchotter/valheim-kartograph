import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.ts';
import { migrations } from '../server/db/migrations.ts';
import { persistMarkerDraftBeforeTransfer } from '../client/src/lib/markerConfirmation.ts';
import { parseRealtimeMessage } from '../client/src/lib/realtime.ts';
import { MapLayer, type Marker } from '../shared/domain.ts';

const marker: Marker = {
  id: crypto.randomUUID(), mapId: crypto.randomUUID(), objectType: 'marker', layer: MapLayer.Markers,
  orderKey: 1, objectVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null,
  minX: 0, minY: 0, maxX: 0, maxY: 0, markerType: 'vegvisir', x: 0, y: 0,
  name: null, note: null, sizeScale: 1, directionDegrees: 132,
};
const draft = { ...marker, name: 'TEST', directionDegrees: 301 };
let selected = marker.id, preview: Marker | null = draft, error: string | null = null, saved = marker;
let release!: (value: boolean) => void;
const save = async (value: Marker) => {
  assert.equal(value.directionDegrees, 301);
  const ok = await new Promise<boolean>(resolve => { release = resolve; });
  if (ok) { saved = value; error = null; } else error = 'Could not save Marker.';
  return ok;
};
const transfer = async () => {
  const ok = await persistMarkerDraftBeforeTransfer({ marker: saved, draft, save,
    isCurrent: () => selected === marker.id,
    accepted: () => { preview = null; },
  });
  if (ok) selected = 'target';
  return ok;
};
const failed = transfer();
assert.equal(preview?.directionDegrees, 301, 'preview retained during network request');
release(false);
assert.equal(await failed, false);
assert.equal(selected, marker.id);
assert.equal(preview?.directionDegrees, 301);
assert.ok(error);
assert.equal(saved.directionDegrees, 132);
const retry = transfer(); release(true);
assert.equal(await retry, true);
assert.equal(saved.directionDegrees, 301);
assert.equal(saved.name, 'TEST');
assert.equal(preview, null);
assert.equal(selected, 'target');
assert.equal(error, null);
let saves = 0;
assert.equal(persistMarkerDraftBeforeTransfer({ marker: draft, draft, isCurrent: () => true,
  save: async () => { saves++; return true; }, accepted: () => {} }), true);
assert.equal(saves, 0, 'unchanged final values never issue a duplicate mutation');
assert.equal(await persistMarkerDraftBeforeTransfer({ marker, draft, pending: Promise.resolve(false), pendingDraft: draft,
  isCurrent: () => true, save: async () => { saves++; return true; }, accepted: () => assert.fail('failed pending save cannot clear draft') }), false);
assert.equal(saves, 0);

const event = {
  type: 'map.object.accepted', mapId: marker.mapId, revision: 1, operationId: crypto.randomUUID(), actorId: crypto.randomUUID(),
  clientOperationId: crypto.randomUUID(), operationType: 'object.create', objectId: marker.id, objectType: 'marker',
  baseObjectVersion: null, createdAt: marker.createdAt, payload: { before: null, after: marker },
};
assert.ok(parseRealtimeMessage(event), 'full valid Marker is accepted');
for (const after of [{ id: marker.id, mapId: marker.mapId, objectType: 'marker' }, { ...marker, x: NaN },
  { ...marker, markerType: 'custom_unrecognised' }, { ...marker, directionDegrees: 360 }, { ...marker, name: undefined }]) {
  assert.equal(parseRealtimeMessage({ ...event, payload: { before: null, after } }), null);
}
const { x, y, markerType, name, note, sizeScale, directionDegrees, ...metadata } = marker;
const path = { ...metadata, objectType: 'path', layer: 100, pathType: 'path', geometryType: 'straight', strokeWidth: 4, points: [[0, 0], [10000, 0]] };
assert.ok(parseRealtimeMessage({ ...event, objectType: 'path', payload: { before: null, after: path } }));
assert.equal(parseRealtimeMessage({ ...event, objectType: 'path', payload: { before: null, after: { id: marker.id, mapId: marker.mapId, objectType: 'path' } } }), null);
assert.equal(parseRealtimeMessage({ ...event, objectType: 'path', payload: { before: null, after: { ...path, points: [[0, 0]] } } }), null);
for (const object of [
  { ...metadata, objectType: 'biome_stroke', layer: 0, mode: 'paint', biome: 'deep_north', brushWidth: 1000, points: [[0, 0]] },
  { ...metadata, objectType: 'biome_stroke', layer: 0, mode: 'erase', biome: null, brushWidth: 1000, points: [[0, 0]] },
  { ...metadata, objectType: 'label', layer: 300, x: 0, y: 0, text: 'Test', fontSize: 24, referenceZoom: 0.79, rotationDegrees: 30 },
]) {
  assert.ok(parseRealtimeMessage({ ...event, objectType: object.objectType, payload: { before: null, after: object } }));
  const broken = object.objectType === 'label' ? { ...object, referenceZoom: undefined } : { ...object, points: [[Infinity, 0]] };
  assert.equal(parseRealtimeMessage({ ...event, objectType: object.objectType, payload: { before: null, after: broken } }), null);
}

const directory = mkdtempSync(join(tmpdir(), 'kartograph-release-'));
const db = new Database(':memory:');
for (const migration of migrations) migration.up(db);
mkdirSync(join(directory, 'markers'));
writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Valheim Kartograph</title>');
writeFileSync(join(directory, 'markers', 'test.png'), Buffer.from([137, 80, 78, 71]));
const app = await createApp({ database: db, staticRoot: directory });
try {
  for (const url of ['/markers/missing.png', '/assets/missing.js', '/fonts/missing.woff2', '/api/unknown', '/api']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, url);
  }
  const png = await app.inject({ method: 'GET', url: '/markers/test.png' });
  assert.equal(png.statusCode, 200); assert.match(String(png.headers['content-type']), /^image\/png/);
  const navigation = await app.inject({ method: 'GET', url: '/maps/example' });
  assert.equal(navigation.statusCode, 200); assert.match(navigation.body, /Valheim Kartograph/);
  const malformed = await app.inject({ method: 'POST', url: '/api/maps', headers: { 'content-type': 'application/json' }, payload: '{' });
  assert.equal(malformed.statusCode, 400); assert.equal(malformed.json().stack, undefined);
  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
} finally {
  await app.close(); db.close(); rmSync(directory, { recursive: true, force: true });
}
console.log('Release regressions: Marker failed-save recovery, realtime validation, static 404 and HTTP 400 passed.');
