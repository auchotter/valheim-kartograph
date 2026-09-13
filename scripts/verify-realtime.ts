import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import { createApp } from '../server/app.ts';
import { migrations, type Migration } from '../server/db/migrations.ts';
import type { MapObjectAcceptedMessage, RealtimeServerMessage } from '../shared/realtime.ts';
import { applyAcceptedObjectEvent, classifyRealtimeRevision, parseRealtimeMessage } from '../client/src/lib/realtime.ts';

interface SocketQueue {
  socket: WebSocket;
  next(timeout?: number): Promise<RealtimeServerMessage>;
  nextAccepted(timeout?: number): Promise<MapObjectAcceptedMessage>;
}

function createSocketQueue(socket: WebSocket): SocketQueue {
  const messages: RealtimeServerMessage[] = [];
  const waiters = new Set<(message: RealtimeServerMessage) => void>();
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as RealtimeServerMessage;
    const waiter = waiters.values().next().value as ((message: RealtimeServerMessage) => void) | undefined;
    if (waiter === undefined) {
      messages.push(message);
    } else {
      waiters.delete(waiter);
      waiter(message);
    }
  });

  const next = (timeout = 1_000): Promise<RealtimeServerMessage> => {
    const existing = messages.shift();
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const waiter = (message: RealtimeServerMessage): void => {
        clearTimeout(timer);
        resolve(message);
      };
      timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error('Timed out waiting for WebSocket message.'));
      }, timeout);
      waiters.add(waiter);
    });
  };

  return {
    socket,
    next,
    async nextAccepted(timeout = 1_000): Promise<MapObjectAcceptedMessage> {
      const message = await next(timeout);
      if (message.type !== 'map.object.accepted') {
        throw new Error(`Expected object event, received ${message.type}.`);
      }
      return message;
    },
  };
}

const directory = mkdtempSync(join(tmpdir(), 'valheim-map-realtime-'));
const database = new Database(join(directory, 'verification.sqlite'));
database.pragma('foreign_keys = ON');
applyMigrations(database, migrations);
const app = await createApp({ database });

try {
  await app.ready();
  const map = await createMap('Shared World');
  const actorA = id(1);
  const actorB = id(2);
  const socketA = await openSocket(`/api/maps/${map.id}/ws`);
  const socketB = await openSocket(`/api/maps/${map.id}/ws`);
  assert.equal((await socketA.next()).type, 'map.ready');
  assert.equal((await socketB.next()).type, 'map.ready');

  const stroke = {
    id: id(10),
    objectType: 'biome_stroke',
    mode: 'paint',
    biome: 'meadows',
    brushWidth: 40,
    points: [[-20, -10], [30, 40]],
  };
  const strokeOperation = id(100);
  const strokeResponse = await request('POST', `/api/maps/${map.id}/objects`, {
    actorId: actorA,
    clientOperationId: strokeOperation,
    object: stroke,
  });
  assert.equal(strokeResponse.statusCode, 201);
  const strokeEventA = await socketA.nextAccepted();
  const strokeEventB = await socketB.nextAccepted();
  assert.equal(strokeEventA.clientOperationId, strokeOperation);
  assert.equal(strokeEventB.payload.after?.objectType, 'biome_stroke');
  assert.equal(strokeEventA.revision, 1);
  const parsedStroke = parseRealtimeMessage(JSON.stringify(strokeEventA));
  assert.equal(parsedStroke?.type, 'map.object.accepted');
  if (parsedStroke?.type === 'map.object.accepted') {
    const applied = applyAcceptedObjectEvent([], parsedStroke);
    assert.equal(applied?.length, 1);
    assert.equal(applyAcceptedObjectEvent(applied ?? [], parsedStroke)?.length, 1);
  }
  assert.equal(classifyRealtimeRevision(4, 3), 'old');
  assert.equal(classifyRealtimeRevision(4, 4), 'duplicate');
  assert.equal(classifyRealtimeRevision(4, 5), 'next');
  assert.equal(classifyRealtimeRevision(4, 6), 'gap');

  const retry = await request('POST', `/api/maps/${map.id}/objects`, {
    actorId: actorA,
    clientOperationId: strokeOperation,
    object: stroke,
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json.idempotent, true);
  await assertNoAcceptedEvent(socketA);
  await assertNoAcceptedEvent(socketB);

  const path = {
    id: id(11),
    objectType: 'path',
    pathType: 'path',
    geometryType: 'straight',
    strokeWidth: 8,
    points: [[0, 0], [100, 0]],
  };
  const pathCreate = await mutate('/objects', actorB, 101, path, map.id);
  assert.equal(pathCreate.statusCode, 201);
  await expectOperation(socketA, 'object.create', 'path', 2);
  await expectOperation(socketB, 'object.create', 'path', 2);

  const pathUpdate = { ...path, points: [[0, 0], [120, 25]] };
  const updateResponse = await request('PUT', `/api/maps/${map.id}/objects/${path.id}`, {
    actorId: actorB,
    clientOperationId: id(102),
    baseObjectVersion: 1,
    object: pathUpdate,
  });
  assert.equal(updateResponse.statusCode, 200);
  await expectOperation(socketA, 'object.update', 'path', 3);
  await expectOperation(socketB, 'object.update', 'path', 3);

  const deleteResponse = await request('DELETE', `/api/maps/${map.id}/objects/${path.id}`, {
    actorId: actorA,
    clientOperationId: id(103),
    baseObjectVersion: 2,
  });
  assert.equal(deleteResponse.statusCode, 200);
  const deleteEvent = await socketB.nextAccepted();
  assert.equal(deleteEvent.operationType, 'object.delete');
  assert.notEqual(deleteEvent.payload.after?.deletedAt, null);
  await socketA.nextAccepted();

  const restoreResponse = await request('POST', `/api/maps/${map.id}/objects/${path.id}/restore`, {
    actorId: actorA,
    clientOperationId: id(104),
    baseObjectVersion: 3,
  });
  assert.equal(restoreResponse.statusCode, 200);
  const restoreEvent = await socketB.nextAccepted();
  assert.equal(restoreEvent.operationType, 'object.restore');
  assert.equal(restoreEvent.payload.after?.deletedAt, null);
  await socketA.nextAccepted();

  const marker = {
    id: id(12),
    objectType: 'marker',
    markerType: 'home',
    x: 12,
    y: 25,
    name: null,
    note: null,
    sizeScale: 1,
    directionDegrees: null,
  };
  const markerCreate = await mutate('/objects', actorA, 105, marker, map.id);
  assert.equal(markerCreate.statusCode, 201);
  await expectOperation(socketA, 'object.create', 'marker', 6);
  await expectOperation(socketB, 'object.create', 'marker', 6);

  const markerUpdate = await request('PUT', `/api/maps/${map.id}/objects/${marker.id}`, {
    actorId: actorB,
    clientOperationId: id(106),
    baseObjectVersion: 1,
    object: { ...marker, x: 50, sizeScale: 2 },
  });
  assert.equal(markerUpdate.statusCode, 200);
  await expectOperation(socketA, 'object.update', 'marker', 7);
  await expectOperation(socketB, 'object.update', 'marker', 7);

  const markerDelete = await request('DELETE', `/api/maps/${map.id}/objects/${marker.id}`, {
    actorId: actorB,
    clientOperationId: id(107),
    baseObjectVersion: 2,
  });
  assert.equal(markerDelete.statusCode, 200);
  await expectOperation(socketA, 'object.delete', 'marker', 8);
  await expectOperation(socketB, 'object.delete', 'marker', 8);

  const markerRestore = await request('POST', `/api/maps/${map.id}/objects/${marker.id}/restore`, {
    actorId: actorB,
    clientOperationId: id(108),
    baseObjectVersion: 3,
  });
  assert.equal(markerRestore.statusCode, 200);
  await expectOperation(socketA, 'object.restore', 'marker', 9);
  await expectOperation(socketB, 'object.restore', 'marker', 9);

  const otherMap = await createMap('Other World');
  const socketOther = await openSocket(`/api/maps/${otherMap.id}/ws`);
  assert.equal((await socketOther.next()).type, 'map.ready');
  await mutate('/objects', actorA, 109, {
    id: id(13),
    objectType: 'biome_stroke',
    mode: 'erase',
    biome: null,
    brushWidth: 20,
    points: [[0, 0]],
  }, map.id);
  await expectOperation(socketA, 'object.create', 'biome_stroke', 10);
  await expectOperation(socketB, 'object.create', 'biome_stroke', 10);
  await assertNoAcceptedEvent(socketOther);

  socketB.socket.terminate();
  const reconnect = await openSocket(`/api/maps/${map.id}/ws`);
  const reconnectReady = await reconnect.next();
  assert.equal(reconnectReady.type, 'map.ready');
  if (reconnectReady.type === 'map.ready') {
    assert.equal(reconnectReady.revision, 10);
  }

  const deleteMapResponse = await request('DELETE', `/api/maps/${otherMap.id}`);
  assert.equal(deleteMapResponse.statusCode, 204);
  const unavailable = await socketOther.next();
  assert.deepEqual(unavailable, { type: 'map.unavailable', mapId: otherMap.id });

  console.log('Realtime collaboration verification passed');
  for (const connection of [socketA, socketB, socketOther, reconnect]) {
    connection.socket.terminate();
  }
} finally {
  await app.close();
  database.close();
  rmSync(directory, { recursive: true, force: true });
}

async function createMap(name: string): Promise<{ id: string }> {
  const response = await request('POST', '/api/maps', { name });
  assert.equal(response.statusCode, 201);
  return response.json.map as { id: string };
}

async function mutate(path: string, actorId: string, operationNumber: number, object: unknown, mapId: string) {
  return request('POST', `/api/maps/${mapId}${path}`, {
    actorId,
    clientOperationId: id(operationNumber),
    object,
  });
}

async function expectOperation(
  connection: SocketQueue,
  operationType: string,
  objectType: string,
  revision: number,
): Promise<void> {
  const event = await connection.nextAccepted();
  assert.equal(event.operationType, operationType);
  assert.equal(event.objectType, objectType);
  assert.equal(event.revision, revision);
}

async function assertNoAcceptedEvent(connection: SocketQueue): Promise<void> {
  await assert.rejects(connection.nextAccepted(100), /Timed out/);
}

async function openSocket(path: string): Promise<SocketQueue> {
  let queue: SocketQueue | undefined;
  await app.injectWS(path, {}, {
    onInit: (socket) => {
      queue = createSocketQueue(socket);
    },
  });
  if (queue === undefined) {
    throw new Error('WebSocket injection did not initialize a client.');
  }
  return queue;
}

async function request(method: string, url: string, payload?: unknown) {
  const response = await app.inject({ method, url, payload });
  return {
    statusCode: response.statusCode,
    json: response.body === '' ? {} : (response.json() as Record<string, any>),
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
