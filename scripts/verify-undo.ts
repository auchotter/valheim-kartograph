import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import { createApp } from '../server/app.ts';
import { migrations, type Migration } from '../server/db/migrations.ts';

const directory = mkdtempSync(join(tmpdir(), 'valheim-map-undo-'));
const database = new Database(join(directory, 'verification.sqlite'));
database.pragma('foreign_keys = ON');
applyMigrations(database, migrations);
const app = await createApp({ database });

const actorA = id(1);
const actorB = id(2);
let clientNumber = 100;

try {
  const map = await createMap('Undo World');

  const marker = markerObject(10, 0, 0);
  const createMarkerClientId = id(clientNumber++);
  assert.equal(
    (await request('POST', `/api/maps/${map.id}/objects`, mutation(actorA, createMarkerClientId, marker))).statusCode,
    201,
  );
  const undoCreateClientId = id(clientNumber++);
  const undoneCreate = await request('POST', `/api/maps/${map.id}/undo`, {
    actorId: actorA,
    clientOperationId: undoCreateClientId,
  });
  assert.equal(undoneCreate.statusCode, 200);
  assert.equal(undoneCreate.json.undone, true);
  assert.equal(undoneCreate.json.action, 'object.delete');
  assert.equal((await state(map.id)).objects.length, 0);

  const retryUndo = await request('POST', `/api/maps/${map.id}/undo`, {
    actorId: actorA,
    clientOperationId: undoCreateClientId,
  });
  assert.equal(retryUndo.statusCode, 200);
  assert.equal(retryUndo.json.undone, true);
  assert.equal(retryUndo.json.inverseOperationId, undoneCreate.json.inverseOperationId);
  assert.equal(retryUndo.json.targetOperationId, undoneCreate.json.targetOperationId);
  assert.equal(retryUndo.json.idempotent, true);
  assert.equal(revision(map.id), 2);

  const path = pathObject(11, [[0, 0], [10, 0]]);
  assert.equal((await request('POST', `/api/maps/${map.id}/objects`, mutation(actorA, id(clientNumber++), path))).statusCode, 201);
  const updatedPath = { ...path, points: [[0, 0], [30, 15]] };
  assert.equal(
    (await request('PUT', `/api/maps/${map.id}/objects/${path.id}`, {
      ...mutation(actorA, id(clientNumber++)),
      baseObjectVersion: 1,
      object: updatedPath,
    })).statusCode,
    200,
  );
  const undoUpdate = await undo(map.id, actorA);
  assert.equal(undoUpdate.json.action, 'object.update');
  assert.deepEqual((await state(map.id)).objects.find((object: any) => object.id === path.id).points, path.points);
  const undoPathCreate = await undo(map.id, actorA);
  assert.equal(undoPathCreate.json.action, 'object.delete');
  assert.equal((await state(map.id)).objects.some((object: any) => object.id === path.id), false);

  const deletedMarker = markerObject(12, 3, 4);
  assert.equal((await request('POST', `/api/maps/${map.id}/objects`, mutation(actorA, id(clientNumber++), deletedMarker))).statusCode, 201);
  assert.equal(
    (await request('DELETE', `/api/maps/${map.id}/objects/${deletedMarker.id}`, {
      ...mutation(actorA, id(clientNumber++)),
      baseObjectVersion: 1,
    })).statusCode,
    200,
  );
  const undoDelete = await undo(map.id, actorA);
  assert.equal(undoDelete.json.action, 'object.restore');
  assert.equal((await state(map.id)).objects.some((object: any) => object.id === deletedMarker.id), true);
  const undoOriginalCreateAfterRestore = await undo(map.id, actorA);
  assert.equal(undoOriginalCreateAfterRestore.json.action, 'object.delete');
  assert.equal((await state(map.id)).objects.some((object: any) => object.id === deletedMarker.id), false);

  const isolatedA = markerObject(13, 20, 20);
  const isolatedB = markerObject(14, 30, 30);
  assert.equal((await request('POST', `/api/maps/${map.id}/objects`, mutation(actorA, id(clientNumber++), isolatedA))).statusCode, 201);
  assert.equal((await request('POST', `/api/maps/${map.id}/objects`, mutation(actorB, id(clientNumber++), isolatedB))).statusCode, 201);
  await undo(map.id, actorA);
  const isolatedState = await state(map.id);
  assert.equal(isolatedState.objects.some((object: any) => object.id === isolatedA.id), false);
  assert.equal(isolatedState.objects.some((object: any) => object.id === isolatedB.id), true);

  const conflictMap = await createMap('Conflict World');
  const conflictMarker = markerObject(15, 0, 0);
  assert.equal((await request('POST', `/api/maps/${conflictMap.id}/objects`, mutation(actorA, id(clientNumber++), conflictMarker))).statusCode, 201);
  assert.equal(
    (await request('PUT', `/api/maps/${conflictMap.id}/objects/${conflictMarker.id}`, {
      ...mutation(actorA, id(clientNumber++)),
      baseObjectVersion: 1,
      object: { ...conflictMarker, x: 100 },
    })).statusCode,
    200,
  );
  assert.equal(
    (await request('PUT', `/api/maps/${conflictMap.id}/objects/${conflictMarker.id}`, {
      ...mutation(actorB, id(clientNumber++)),
      baseObjectVersion: 2,
      object: { ...conflictMarker, x: 200 },
    })).statusCode,
    200,
  );
  const unsafeUndo = await undo(conflictMap.id, actorA);
  assert.equal(unsafeUndo.json.undone, false);
  assert.equal((await state(conflictMap.id)).objects.find((object: any) => object.id === conflictMarker.id).x, 200);

  const erase = {
    id: id(16), objectType: 'biome_stroke', mode: 'erase', biome: null,
    brushWidth: 20, points: [[0, 0]],
  };
  assert.equal((await request('POST', `/api/maps/${map.id}/objects`, mutation(actorA, id(clientNumber++), erase))).statusCode, 201);
  const undoErase = await undo(map.id, actorA);
  assert.equal(undoErase.json.action, 'object.delete');

  const realtimeMap = await createMap('Undo Realtime World');
  const realtimeSocket = await openSocket(`/api/maps/${realtimeMap.id}/ws`);
  assert.equal((await realtimeSocket.next()).type, 'map.ready');
  const realtimeMarker = markerObject(17, 1, 1);
  assert.equal((await request('POST', `/api/maps/${realtimeMap.id}/objects`, mutation(actorA, id(clientNumber++), realtimeMarker))).statusCode, 201);
  assert.equal((await realtimeSocket.next()).type, 'map.object.accepted');
  const realtimeUndo = await undo(realtimeMap.id, actorA);
  assert.equal(realtimeUndo.json.undone, true);
  const inverseEvent = await realtimeSocket.next();
  assert.equal(inverseEvent.type, 'map.object.accepted');
  if (inverseEvent.type === 'map.object.accepted') {
    assert.equal(inverseEvent.operationType, 'object.delete');
    assert.equal(inverseEvent.objectId, realtimeMarker.id);
  }
  realtimeSocket.socket.terminate();

  // Twenty undoable operations are considered per actor; the oldest of 21
  // creations remains after walking the window backwards.
  const historyMap = await createMap('History World');
  const historyMarkers = Array.from({ length: 21 }, (_, index) => markerObject(100 + index, index, index));
  for (const object of historyMarkers) {
    assert.equal((await request('POST', `/api/maps/${historyMap.id}/objects`, mutation(actorA, id(clientNumber++), object))).statusCode, 201);
  }
  for (let index = 0; index < 20; index += 1) {
    const result = await undo(historyMap.id, actorA);
    assert.equal(result.json.undone, true);
  }
  const remainingHistory = await state(historyMap.id);
  assert.deepEqual(remainingHistory.objects.map((object: any) => object.id), [historyMarkers[0].id]);

  const operationRows = database
    .prepare('SELECT undo_of_operation_id FROM map_operations WHERE map_id = ? AND undo_of_operation_id IS NOT NULL')
    .all(map.id) as Array<{ undo_of_operation_id: string }>;
  assert.ok(operationRows.length > 0);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM map_operations WHERE map_id = ?').get(map.id)?.count,
    revision(map.id),
  );

  console.log('Undo verification passed');
} finally {
  await app.close();
  database.close();
  rmSync(directory, { recursive: true, force: true });
}

async function undo(mapId: string, actor: string) {
  return request('POST', `/api/maps/${mapId}/undo`, {
    actorId: actor,
    clientOperationId: id(clientNumber++),
  });
}

async function createMap(name: string): Promise<{ id: string }> {
  const response = await request('POST', '/api/maps', { name });
  assert.equal(response.statusCode, 201);
  return response.json.map as { id: string };
}

async function state(mapId: string): Promise<{ objects: any[] }> {
  const response = await request('GET', `/api/maps/${mapId}`);
  assert.equal(response.statusCode, 200);
  return response.json as { objects: any[] };
}

function revision(mapId: string): number {
  return (database.prepare('SELECT revision FROM maps WHERE id = ?').get(mapId) as { revision: number }).revision;
}

function markerObject(number: number, x: number, y: number) {
  return {
    id: id(number), objectType: 'marker', markerType: 'home', x, y,
    name: null, note: null, sizeScale: 1, directionDegrees: null,
  };
}

function pathObject(number: number, points: number[][]) {
  return { id: id(number), objectType: 'path', pathType: 'path', geometryType: 'straight', strokeWidth: 8, points };
}

function mutation(actor: string, clientOperationId: string, object?: unknown) {
  return { actorId: actor, clientOperationId, ...(object === undefined ? {} : { object }) };
}

async function request(method: string, url: string, payload?: unknown) {
  const response = await app.inject({ method, url, payload });
  return {
    statusCode: response.statusCode,
    json: response.body === '' ? {} : response.json() as Record<string, any>,
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

interface SocketQueue {
  socket: WebSocket;
  next(timeout?: number): Promise<any>;
}

async function openSocket(path: string): Promise<SocketQueue> {
  let queue: SocketQueue | undefined;
  await app.injectWS(path, {}, {
    onInit: (socket) => {
      const messages: any[] = [];
      const waiters: Array<{ resolve: (message: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString());
        const waiter = waiters.shift();
        if (waiter === undefined) {
          messages.push(message);
        } else {
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      });
      queue = {
        socket,
        next(timeout = 1_000) {
          const message = messages.shift();
          if (message !== undefined) {
            return Promise.resolve(message);
          }
          return new Promise((resolve, reject) => {
            const waiter = {
              resolve,
              reject,
              timer: setTimeout(() => reject(new Error('Timed out waiting for WebSocket message.')), timeout),
            };
            waiters.push(waiter);
          });
        },
      };
    },
  });
  if (queue === undefined) {
    throw new Error('WebSocket injection did not initialize a client.');
  }
  return queue;
}
