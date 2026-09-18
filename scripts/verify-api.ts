import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.ts';
import { migrations, type Migration } from '../server/db/migrations.ts';

const directory = mkdtempSync(join(tmpdir(), 'valheim-map-api-'));
const database = new Database(join(directory, 'verification.sqlite'));
database.pragma('foreign_keys = ON');
applyMigrations(database, migrations);
const app = await createApp({ database });

try {
  const map = await createMap('Our World');
  const initialState = await request('GET', `/api/maps/${map.id}`);
  const initialSpawns = initialState.json.objects.filter(
    (object: { objectType: string; markerType?: string }) => object.objectType === 'marker' && object.markerType === 'spawn',
  );
  assert.equal(initialSpawns.length, 1);
  assert.deepEqual(
    {
      x: initialSpawns[0].x,
      y: initialSpawns[0].y,
      name: initialSpawns[0].name,
      layer: initialSpawns[0].layer,
      objectVersion: initialSpawns[0].objectVersion,
      sizeScale: initialSpawns[0].sizeScale,
    },
    { x: 0, y: 0, name: null, layer: 200, objectVersion: 1, sizeScale: 1 },
  );
  assert.equal(initialState.json.map.revision, 0);
  assert.equal(initialState.json.map.nextOrderKey, 1);
  assert.equal(
    (database.prepare('SELECT count(*) AS count FROM map_operations WHERE map_id = ?').get(map.id) as { count: number }).count,
    0,
  );
  assert.equal((await request('GET', '/api/maps')).json.maps.length, 1);
  assert.equal((await request('POST', '/api/maps', { name: 'our world' })).statusCode, 409);
  assert.equal((await request('PATCH', `/api/maps/${map.id}`, { name: 'Renamed World' })).json.map.name, 'Renamed World');

  const actorId = id(100);
  let operationNumber = 1;
  const mutation = (object: unknown, extra: Record<string, unknown> = {}) => ({
    actorId,
    clientOperationId: id(operationNumber++),
    ...extra,
    ...(object === null ? {} : { object }),
  });

  const lavaStroke = {
    id: id(1),
    objectType: 'biome_stroke',
    mode: 'paint',
    biome: 'lava',
    brushWidth: 20,
    points: [[-10, -20], [30, 40]],
  };
  const createdLava = await request('POST', `/api/maps/${map.id}/objects`, mutation(lavaStroke));
  assert.equal(createdLava.statusCode, 201);
  assert.equal(createdLava.json.object.layer, 0);
  assert.deepEqual(pickBounds(createdLava.json.object), { minX: -20, minY: -30, maxX: 40, maxY: 50 });
  const initialRevision = createdLava.json.mapRevision;
  const retry = await request('POST', `/api/maps/${map.id}/objects`, {
    actorId,
    clientOperationId: id(1),
    object: lavaStroke,
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json.idempotent, true);
  assert.equal(retry.json.mapRevision, initialRevision);

  const updatedLava = await request(
    'PUT',
    `/api/maps/${map.id}/objects/${id(1)}`,
    mutation({ ...lavaStroke, points: [[-20, -20], [20, 20]] }, { baseObjectVersion: 1 }),
  );
  assert.equal(updatedLava.statusCode, 200);
  assert.equal(updatedLava.json.object.objectVersion, 2);
  assert.equal(
    (await request(
      'PUT',
      `/api/maps/${map.id}/objects/${id(1)}`,
      mutation(lavaStroke, { baseObjectVersion: 1 }),
    )).statusCode,
    409,
  );

  const eraseStroke = {
    id: id(2),
    objectType: 'biome_stroke',
    mode: 'erase',
    biome: null,
    brushWidth: 10,
    points: [[0, 0]],
  };
  assert.equal((await request('POST', `/api/maps/${map.id}/objects`, mutation(eraseStroke))).statusCode, 201);

  const paths = [
    { id: id(3), pathType: 'path', geometryType: 'freehand', points: [[0, 0], [5, 5], [10, 0]] },
    { id: id(4), pathType: 'road', geometryType: 'straight', points: [[-5, -5], [5, 5]] },
    { id: id(5), pathType: 'sailing_route', geometryType: 'curve', points: [[0, 0], [5, -10], [10, 0]] },
  ];
  for (const path of paths) {
    const response = await request(
      'POST',
      `/api/maps/${map.id}/objects`,
      mutation({ ...path, objectType: 'path', strokeWidth: 4 }),
    );
    assert.equal(response.statusCode, 201);
  }
  assert.equal(
    (
      await request(
        'POST',
        `/api/maps/${map.id}/objects`,
        mutation({ id: id(6), objectType: 'path', pathType: 'path', geometryType: 'straight', strokeWidth: 2, points: [[0, 0]] }),
      )
    ).statusCode,
    400,
  );

  const marker = {
    id: id(7),
    objectType: 'marker',
    markerType: 'vegvisir',
    x: -120,
    y: 45,
    name: 'Crypt direction',
    note: 'Follow this heading.',
    sizeScale: 1.5,
    directionDegrees: 135,
  };
  const createdMarker = await request('POST', `/api/maps/${map.id}/objects`, mutation(marker));
  assert.equal(createdMarker.statusCode, 201);
  assert.equal(createdMarker.json.object.sizeScale, 1.5);
  assert.equal(createdMarker.json.object.directionDegrees, 135);
  const updatedMarker = await request(
    'PUT',
    `/api/maps/${map.id}/objects/${id(7)}`,
    mutation({ ...marker, sizeScale: 2 }, { baseObjectVersion: 1 }),
  );
  assert.equal(updatedMarker.json.object.sizeScale, 2);
  assert.equal(updatedMarker.json.object.objectVersion, 2);
  const markerTwo = await request(
    'POST',
    `/api/maps/${map.id}/objects`,
    mutation({ ...marker, id: id(8), markerType: 'home', directionDegrees: null }),
  );
  assert.ok(markerTwo.json.object.orderKey > createdMarker.json.object.orderKey);

  const label = await request(
    'POST',
    `/api/maps/${map.id}/objects`,
    mutation({
      id: id(9),
      objectType: 'label',
      x: -1,
      y: -2,
      text: 'North gate',
      fontSize: 18,
      referenceZoom: 0.79,
      rotationDegrees: 45,
    }),
  );
  assert.equal(label.statusCode, 201);
  assert.equal(label.json.object.layer, 300);
  assert.equal(label.json.object.referenceZoom, 0.79);
  assert.equal(label.json.object.rotationDegrees, 45);
  for (const referenceZoom of [0, -1, Number.POSITIVE_INFINITY, 8.01]) {
    const invalid = await request(
      'POST',
      `/api/maps/${map.id}/objects`,
      mutation({
        id: crypto.randomUUID(), objectType: 'label', x: 0, y: 0,
        text: 'Invalid zoom', fontSize: 18, referenceZoom, rotationDegrees: 0,
      }),
    );
    assert.equal(invalid.statusCode, 400);
  }
  // Older clients may omit the new field during an unrelated edit; retain the
  // established reference zoom rather than silently re-anchoring the label.
  const updatedLabel = await request(
    'PUT',
    `/api/maps/${map.id}/objects/${id(9)}`,
    mutation({ id: id(9), objectType: 'label', x: 3, y: -2, text: 'North gate', fontSize: 24, rotationDegrees: 90 }, { baseObjectVersion: 1 }),
  );
  assert.equal(updatedLabel.statusCode, 200);
  assert.deepEqual(
    pickBounds(updatedLabel.json.object),
    { minX: 3, minY: -2, maxX: 3, maxY: -2 },
  );
  assert.equal(updatedLabel.json.object.rotationDegrees, 90);
  assert.equal(updatedLabel.json.object.referenceZoom, 0.79);
  const resizedLabel = await request(
    'PUT',
    `/api/maps/${map.id}/objects/${id(9)}`,
    mutation(
      {
        id: id(9),
        objectType: 'label',
        x: 3,
        y: -2,
        text: 'North gate',
        fontSize: 30,
        referenceZoom: 1.5,
        rotationDegrees: 90,
      },
      { baseObjectVersion: 2 },
    ),
  );
  assert.equal(resizedLabel.statusCode, 200);
  assert.equal(resizedLabel.json.object.fontSize, 30);
  assert.equal(resizedLabel.json.object.referenceZoom, 1.5);
  const resizeOperation = database
    .prepare("SELECT payload_json FROM map_operations WHERE map_id = ? AND object_id = ? AND operation_type = 'object.update' ORDER BY map_revision DESC LIMIT 1")
    .get(map.id, id(9)) as { payload_json: string };
  assert.deepEqual(
    (({ before, after }) => ({
      before: { fontSize: before.fontSize, referenceZoom: before.referenceZoom },
      after: { fontSize: after.fontSize, referenceZoom: after.referenceZoom },
    }))(JSON.parse(resizeOperation.payload_json)),
    {
      before: { fontSize: 24, referenceZoom: 0.79 },
      after: { fontSize: 30, referenceZoom: 1.5 },
    },
  );
  const deletedLabel = await request(
    'DELETE',
    `/api/maps/${map.id}/objects/${id(9)}`,
    mutation(null, { baseObjectVersion: 3 }),
  );
  assert.equal(deletedLabel.statusCode, 200);
  assert.notEqual(deletedLabel.json.object.deletedAt, null);
  const restoredLabel = await request(
    'POST',
    `/api/maps/${map.id}/objects/${id(9)}/restore`,
    mutation(null, { baseObjectVersion: 4 }),
  );
  assert.equal(restoredLabel.statusCode, 200);
  assert.equal(restoredLabel.json.object.deletedAt, null);

  const deletedMarker = await request(
    'DELETE',
    `/api/maps/${map.id}/objects/${id(7)}`,
    mutation(null, { baseObjectVersion: 2 }),
  );
  assert.equal(deletedMarker.statusCode, 200);
  assert.notEqual(deletedMarker.json.object.deletedAt, null);
  const stateAfterDelete = await request('GET', `/api/maps/${map.id}`);
  assert.equal(stateAfterDelete.json.objects.some((object: { id: string }) => object.id === id(7)), false);
  const restoredMarker = await request(
    'POST',
    `/api/maps/${map.id}/objects/${id(7)}/restore`,
    mutation(null, { baseObjectVersion: 3 }),
  );
  assert.equal(restoredMarker.statusCode, 200);
  assert.equal(restoredMarker.json.object.objectVersion, 4);
  assert.equal(restoredMarker.json.object.deletedAt, null);

  const loadedState = await request('GET', `/api/maps/${map.id}`);
  assert.deepEqual(
    loadedState.json.objects.map((object: { layer: number; orderKey: number }) => [object.layer, object.orderKey]),
    [...loadedState.json.objects]
      .sort((left: { layer: number; orderKey: number }, right: { layer: number; orderKey: number }) => left.layer - right.layer || left.orderKey - right.orderKey)
      .map((object: { layer: number; orderKey: number }) => [object.layer, object.orderKey]),
  );
  assert.equal(loadedState.json.objects.find((object: { id: string }) => object.id === id(1)).biome, 'lava');

  const operationCount = database.prepare('SELECT count(*) AS count FROM map_operations WHERE map_id = ?').get(map.id) as { count: number };
  const currentMap = database.prepare('SELECT revision FROM maps WHERE id = ?').get(map.id) as { revision: number };
  assert.equal(currentMap.revision, operationCount.count);
  const operationPayload = database.prepare('SELECT payload_json FROM map_operations WHERE map_id = ? LIMIT 1').get(map.id) as { payload_json: string };
  assert.ok('before' in JSON.parse(operationPayload.payload_json));
  assert.ok('after' in JSON.parse(operationPayload.payload_json));

  const duplicate = await request('POST', `/api/maps/${map.id}/duplicate`, { name: 'Copied World' });
  assert.equal(duplicate.statusCode, 201);
  const duplicateState = await request('GET', `/api/maps/${duplicate.json.map.id}`);
  assert.equal(duplicateState.json.objects.length, loadedState.json.objects.length);
  assert.equal(
    duplicateState.json.objects.some(
      (object: { objectType: string; text?: string; referenceZoom?: number; rotationDegrees?: number }) =>
        object.objectType === 'label' && object.text === 'North gate' &&
        object.referenceZoom === 1.5 && object.rotationDegrees === 90,
    ),
    true,
  );
  assert.equal(
    duplicateState.json.objects.filter(
      (object: { objectType: string; markerType?: string }) => object.objectType === 'marker' && object.markerType === 'spawn',
    ).length,
    1,
  );
  assert.equal(
    duplicateState.json.objects.some((object: { id: string }) => loadedState.json.objects.some((source: { id: string }) => source.id === object.id)),
    false,
  );
  assert.equal(
    (database.prepare('SELECT count(*) AS count FROM map_operations WHERE map_id = ?').get(duplicate.json.map.id) as { count: number }).count,
    0,
  );

  const lifecycleMap = await createMap('Spawn Lifecycle World');
  const lifecycleState = await request('GET', `/api/maps/${lifecycleMap.id}`);
  const lifecycleSpawn = lifecycleState.json.objects.find(
    (object: { objectType: string; markerType?: string }) => object.objectType === 'marker' && object.markerType === 'spawn',
  ) as { id: string; objectVersion: number } | undefined;
  assert.ok(lifecycleSpawn !== undefined);
  assert.equal(
    (await request('DELETE', `/api/maps/${lifecycleMap.id}/objects/${lifecycleSpawn?.id}`, {
      actorId: id(500),
      clientOperationId: id(501),
      baseObjectVersion: lifecycleSpawn?.objectVersion,
    })).statusCode,
    200,
  );
  for (const readNumber of [1, 2]) {
    const afterDelete = await request('GET', `/api/maps/${lifecycleMap.id}`);
    assert.equal(
      afterDelete.json.objects.some(
        (object: { objectType: string; markerType?: string }) => object.objectType === 'marker' && object.markerType === 'spawn',
      ),
      false,
      `deleted Spawn was recreated during read ${readNumber}`,
    );
  }
  const deletedDuplicate = await request('POST', `/api/maps/${lifecycleMap.id}/duplicate`, { name: 'Deleted Spawn Copy' });
  assert.equal(deletedDuplicate.statusCode, 201);
  const deletedDuplicateState = await request('GET', `/api/maps/${deletedDuplicate.json.map.id}`);
  assert.equal(
    deletedDuplicateState.json.objects.some(
      (object: { objectType: string; markerType?: string }) => object.objectType === 'marker' && object.markerType === 'spawn',
    ),
    false,
  );
  const undoneSeedDelete = await request('POST', `/api/maps/${lifecycleMap.id}/undo`, {
    actorId: id(500),
    clientOperationId: id(502),
  });
  assert.equal(undoneSeedDelete.statusCode, 200);
  assert.equal(undoneSeedDelete.json.undone, true);
  const restoredLifecycleState = await request('GET', `/api/maps/${lifecycleMap.id}`);
  assert.equal(
    restoredLifecycleState.json.objects.filter(
      (object: { objectType: string; markerType?: string }) => object.objectType === 'marker' && object.markerType === 'spawn',
    ).length,
    1,
  );
  const redoneSeedDelete = await request('POST', `/api/maps/${lifecycleMap.id}/redo`, {
    actorId: id(500),
    clientOperationId: id(503),
  });
  assert.equal(redoneSeedDelete.statusCode, 200);
  assert.equal(redoneSeedDelete.json.redone, true);
  const redoneLifecycleState = await request('GET', `/api/maps/${lifecycleMap.id}`);
  assert.equal(
    redoneLifecycleState.json.objects.some(
      (object: { objectType: string; markerType?: string }) => object.objectType === 'marker' && object.markerType === 'spawn',
    ),
    false,
  );

  const historicalMapId = id(600);
  const historicalTimestamp = new Date(0).toISOString();
  database.prepare(
    `INSERT INTO maps (id, name, revision, next_order_key, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(historicalMapId, 'Historical Empty World', 0, 0, historicalTimestamp, historicalTimestamp);
  const historicalState = await request('GET', `/api/maps/${historicalMapId}`);
  assert.equal(
    historicalState.json.objects.some(
      (object: { objectType: string; markerType?: string }) => object.objectType === 'marker' && object.markerType === 'spawn',
    ),
    false,
  );
  const historicalDuplicate = await request('POST', `/api/maps/${historicalMapId}/duplicate`, { name: 'Historical Empty Copy' });
  assert.equal(historicalDuplicate.statusCode, 201);
  const historicalDuplicateState = await request('GET', `/api/maps/${historicalDuplicate.json.map.id}`);
  assert.equal(historicalDuplicateState.json.objects.length, 0);

  assert.equal((await request('DELETE', `/api/maps/${map.id}`)).statusCode, 204);
  assert.equal((await request('GET', `/api/maps/${map.id}`)).statusCode, 404);
  assert.equal((await request('GET', '/api/health')).json.status, 'ok');
  assert.equal(database.pragma('foreign_keys', { simple: true }), 1);

  console.log('Map and map-object HTTP API verification passed');
} finally {
  await app.close();
  database.close();
  rmSync(directory, { recursive: true, force: true });
}

async function createMap(name: string) {
  const response = await request('POST', '/api/maps', { name });
  assert.equal(response.statusCode, 201);
  return response.json.map as { id: string };
}

async function request(method: string, url: string, payload?: unknown) {
  const response = await app.inject({ method, url, payload });
  return {
    statusCode: response.statusCode,
    json: response.body === '' ? undefined : (response.json() as Record<string, unknown>),
  };
}

function applyMigrations(databaseConnection: Database.Database, migrationsToApply: readonly Migration[]): void {
  for (const migration of migrationsToApply) {
    databaseConnection.transaction(() => {
      migration.up(databaseConnection);
      databaseConnection.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    })();
  }
}

function id(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
}

function pickBounds(object: { minX: number; minY: number; maxX: number; maxY: number }) {
  return { minX: object.minX, minY: object.minY, maxX: object.maxX, maxY: object.maxY };
}
