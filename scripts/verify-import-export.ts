import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MARKER_ICONS } from '../client/src/lib/markerIcons.ts';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.ts';
import { migrations } from '../server/db/migrations.ts';
import { MapRepository } from '../server/repositories/mapRepository.ts';
import { MapService } from '../server/services/mapService.ts';
import { createPortableMap, parsePortableMap, parsePortableMapJson, portableFilename, MAX_MAP_FILE_BYTES, type PortableContent } from '../shared/portableMap.ts';

const database = new Database(':memory:');
database.pragma('foreign_keys = ON');
for (const migration of migrations) migration.up(database);
const service = new MapService(new MapRepository(database));
const app = await createApp({ database });
let events = 0;
service.onAcceptedObjectMutation(() => events++);
const workspace = { markerOpacity: .37, pathOpacity: .62, textOpacity: .84, gridEnabled: true,
  protectEnabled: false, camera: { cameraX: 123, cameraY: -456, zoom: .79 } };
const objects: PortableContent['objects'] = [];
for (const biome of ['meadows', 'mountains', null, 'deep_north', 'lava'] as const) {
  objects.push({ objectType: 'biome_stroke', orderKey: objects.length, mode: biome ? 'paint' : 'erase', biome,
    brushWidth: 120, points: [[0, 0], [100, 100], [220, 60]] });
}
for (const geometryType of ['freehand', 'straight', 'curve'] as const) {
  objects.push({ objectType: 'path', orderKey: objects.length, geometryType, pathType: 'road', strokeWidth: 4,
    points: geometryType === 'straight' ? [[10, 20], [300, 180]] : [[10, 20], [150, -50], [300, 180]] });
}
for (const markerType of ['spawn', 'home', 'vegvisir'] as const) {
  objects.push({ objectType: 'marker', orderKey: objects.length, markerType, x: objects.length * 30, y: 20,
    name: `Caption ${markerType}`, note: 'Preserved note', sizeScale: 1.2, directionDegrees: markerType === 'vegvisir' ? 123 : null });
}
for (const referenceZoom of [.79, 2.5]) {
  objects.push({ objectType: 'label', orderKey: objects.length, x: -100, y: objects.length * 20,
    text: `BASE ${referenceZoom}`, fontSize: 36, referenceZoom, rotationDegrees: 31 });
}
const snapshot = createPortableMap({ name: 'Round trip', objects }, workspace);
try {
  assert.equal(snapshot.format, 'valheim-kartograph');
  assert.equal(snapshot.formatVersion, 1);
  assert.deepEqual(snapshot.application, { name: 'Valheim Kartograph', version: '1.0' });
  assert.equal(MAX_MAP_FILE_BYTES, 64 * 1024 * 1024);
  for (const icon of MARKER_ICONS) assert.doesNotThrow(() => parsePortableMap({ ...snapshot,
    map: { name: 'Catalogue', objects: [{ ...objects[8], markerType: icon.type }] } }));
  assert.equal(portableFilename('A/B:*?'), 'A_B___.valheim-kartograph.json');
  for (const input of ['', '{', '{}']) assert.throws(() => parsePortableMapJson(input));
  assert.throws(() => parsePortableMap({ ...snapshot, formatVersion: 2 }), /Unsupported/);
  assert.doesNotThrow(() => parsePortableMap({ ...snapshot, application: { ...snapshot.application, version: '2.0' } }));
  for (const zoom of [0, -1, Infinity, NaN, 8.01]) {
    assert.throws(() => parsePortableMap({ ...snapshot, workspace: { ...workspace, camera: { ...workspace.camera, zoom } } }));
  }
  for (const bad of [{ ...objects[0], biome: 'unknown' }, { ...objects[6], points: [[0, 0]] },
    { ...objects[8], markerType: 'not-a-marker' }, { ...objects[11], referenceZoom: 0 },
    { ...objects[11], rotationDegrees: 400 }, { ...objects[11], id: randomUUID() }]) {
    assert.throws(() => parsePortableMap({ ...snapshot, map: { ...snapshot.map, objects: [bad] } }));
  }
  assert.throws(() => parsePortableMap({ ...snapshot, map: { name: 'Points limit', objects: [
    { ...objects[0], points: Array.from({ length: 20_001 }, () => [0, 0]) },
  ] } }));
  assert.throws(() => parsePortableMap({ ...snapshot, map: { name: 'Marker limit', objects:
    Array.from({ length: 25_001 }, (_, orderKey) => ({ ...objects[8], orderKey })),
  } }));
  const a = service.importMap(snapshot);
  const before = service.getMapState(a.map.id);
  const exported = service.exportMap(a.map.id);
  assert.deepEqual(exported, snapshot.map);
  assert.deepEqual(service.getMapState(a.map.id), before, 'Export is read-only');
  assert.deepEqual(parsePortableMapJson(JSON.stringify(createPortableMap(exported, workspace))).workspace, workspace);
  const b = service.importMap(createPortableMap(exported, workspace));
  const c = service.importMap(snapshot);
  assert.equal(b.map.name, 'Round trip (Imported)');
  assert.equal(c.map.name, 'Round trip (Imported 2)');
  assert.deepEqual(service.exportMap(b.map.id).objects, exported.objects);
  const ids = [...a.objects, ...b.objects, ...c.objects].map(object => object.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set([a.map.id, b.map.id, c.map.id]).size, 3);
  assert.ok(b.objects.every(object => object.objectVersion === 1));
  assert.equal(b.map.revision, 0);
  assert.equal(events, 0, 'Import/export must not emit object events');
  assert.equal((database.prepare('SELECT count(*) AS n FROM map_operations').get() as { n: number }).n, 0);
  // Exclude soft deletion from current-state export; semantic erase stays active.
  for (const type of ['marker', 'path', 'label']) {
    const object = a.objects.find(object => object.objectType === type)!;
    database.prepare('UPDATE map_objects SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), object.id);
  }
  const noSpawn = service.exportMap(a.map.id);
  assert.equal(noSpawn.objects.length, objects.length - 3);
  assert.ok(noSpawn.objects.some(object => object.objectType === 'biome_stroke' && object.mode === 'erase'));
  const d = service.importMap(createPortableMap(noSpawn, workspace));
  assert.equal(d.objects.filter(object => object.objectType === 'marker' && object.markerType === 'spawn').length, 0);
  assert.deepEqual(service.getMapState(b.map.id), b, 'Another imported map is independent');
  // Force a late insert failure, after the map and terrain/path/markers were inserted.
  const mapsBefore = service.listMaps();
  database.exec("CREATE TEMP TRIGGER fail_label BEFORE INSERT ON labels BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  assert.throws(() => service.importMap(snapshot), /test rollback/);
  assert.deepEqual(service.listMaps(), mapsBefore);
  assert.equal((database.prepare('SELECT count(*) AS n FROM map_objects').get() as { n: number }).n,
    a.objects.length + b.objects.length + c.objects.length + d.objects.length, 'Rollback leaves no partial objects');
  database.exec('DROP TRIGGER fail_label');
  const response = await app.inject({ method: 'POST', url: '/api/maps/import', payload: snapshot });
  assert.equal(response.statusCode, 201, response.body);
  const fromApi = response.json();
  assert.deepEqual((await app.inject({ method: 'GET', url: `/api/maps/${fromApi.map.id}/export` })).json().objects, objects);
  for (const payload of [{}, { ...snapshot, formatVersion: 99 }, { ...snapshot, map: { name: 'Bad', objects: [{ ...objects[11], referenceZoom: -1 }] } }]) {
    const count = service.listMaps().length;
    assert.equal((await app.inject({ method: 'POST', url: '/api/maps/import', payload })).statusCode, 400);
    assert.equal(service.listMaps().length, count);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/maps/import', headers: { 'content-type': 'application/json' }, payload: '{' })).statusCode, 400);
  // Imported baselines are editable and ordinary future history starts normally.
  const actorId = randomUUID();
  const label = b.objects.find(object => object.objectType === 'label')!;
  const edited = service.updateObject(b.map.id, label.id, { actorId, clientOperationId: randomUUID(),
    baseObjectVersion: 1, object: { ...label, objectType: 'label', text: 'Edited imported label' } });
  assert.equal(edited.mapRevision, 1);
  assert.deepEqual(service.getMapState(c.map.id), c, 'Editing an import cannot affect a second import');
  assert.equal(service.undoMap(b.map.id, actorId, randomUUID()).undone, true);
  assert.deepEqual(service.exportMap(b.map.id).objects, exported.objects, 'Undo restores imported baseline');
  assert.equal(service.redoMap(b.map.id, actorId, randomUUID()).redone, true);
  const withHistory = service.exportMap(b.map.id);
  assert.doesNotMatch(JSON.stringify(withHistory), /objectVersion|mapRevision|actorId|clientOperationId|createdAt|deletedAt/);
  const importedHistoryFree = service.importMap(createPortableMap(withHistory, workspace));
  assert.equal((database.prepare('SELECT count(*) AS n FROM map_operations WHERE map_id = ?').get(importedHistoryFree.map.id) as { n: number }).n, 0);
  const threeSpawns = service.importMap(createPortableMap({ name: 'Three Spawn', objects:
    [0, 1, 2].map(orderKey => ({ ...objects[8], orderKey })),
  }, workspace));
  assert.equal(threeSpawns.objects.length, 3, 'Do not suppress or add supplied Spawn markers');
  const created = service.createMap({ name: 'Genuine blank' });
  assert.equal(service.getMapState(created.id).objects.length, 1, 'Normal blank maps still receive Spawn');
  console.log('Import/export verification passed: schema, chronology, all geometry, labels, fresh IDs, atomic rollback, clean history/events, API validation, repeated imports and no-Spawn.');
} finally { await app.close(); database.close(); }
