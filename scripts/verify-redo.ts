import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.ts';
import { migrations, type Migration } from '../server/db/migrations.ts';

const directory = mkdtempSync(join(tmpdir(), 'valheim-map-redo-'));
const database = new Database(join(directory, 'verification.sqlite'));
database.pragma('foreign_keys = ON');
applyMigrations(database, migrations);
const app = await createApp({ database });

const actorA = id(1);
const actorB = id(2);
let clientNumber = 100;

try {
  const map = await createMap('Redo World');
  const marker = markerObject(10, 0, 0);
  await createObject(map.id, actorA, marker);

  const undoCreate = await undo(map.id, actorA);
  assert.equal(undoCreate.json.undone, true);
  const redoCreateClient = id(clientNumber++);
  const redoCreate = await redo(map.id, actorA, redoCreateClient);
  assert.equal(redoCreate.json.redone, true);
  assert.equal((await state(map.id)).objects.length, 1);
  const redoRetry = await redo(map.id, actorA, redoCreateClient);
  assert.equal(redoRetry.json.redone, true);
  assert.equal(redoRetry.json.redoOperationId, redoCreate.json.redoOperationId);
  assert.equal(redoRetry.json.idempotent, true);

  const undoAfterRedo = await undo(map.id, actorA);
  assert.equal(undoAfterRedo.json.undone, true);
  assert.equal((await state(map.id)).objects.length, 0);

  const updated = { ...marker, id: id(11), x: 30, y: 40 };
  await createObject(map.id, actorA, { ...marker, id: updated.id });
  await updateObject(map.id, actorA, updated, 1);
  await undo(map.id, actorA);
  const redoUpdate = await redo(map.id, actorA, id(clientNumber++));
  assert.equal(redoUpdate.json.redone, true);
  assert.deepEqual((await state(map.id)).objects.find((object: any) => object.id === updated.id)?.x, 30);

  const deleted = markerObject(12, 5, 6);
  await createObject(map.id, actorA, deleted);
  await request('DELETE', `/api/maps/${map.id}/objects/${deleted.id}`, lifecycle(actorA, 1));
  await undo(map.id, actorA);
  const redoDelete = await redo(map.id, actorA, id(clientNumber++));
  assert.equal(redoDelete.json.redone, true);
  assert.equal((await state(map.id)).objects.some((object: any) => object.id === deleted.id), false);

  const branchMap = await createMap('Redo Branch World');
  const branchMarker = markerObject(20, 1, 2);
  await createObject(branchMap.id, actorA, branchMarker);
  await undo(branchMap.id, actorA);
  await createObject(branchMap.id, actorA, markerObject(21, 3, 4));
  const abandoned = await redo(branchMap.id, actorA, id(clientNumber++));
  assert.equal(abandoned.json.redone, false);
  assert.equal(abandoned.json.reason, 'empty');

  const collaboratorMap = await createMap('Redo Collaboration World');
  const collaborative = markerObject(30, 10, 10);
  await createObject(collaboratorMap.id, actorA, collaborative);
  const moved = { ...collaborative, x: 20, y: 20 };
  await updateObject(collaboratorMap.id, actorA, moved, 1);
  await undo(collaboratorMap.id, actorA);
  await updateObject(collaboratorMap.id, actorB, { ...collaborative, x: 99, y: 99 }, 3);
  const unsafe = await redo(collaboratorMap.id, actorA, id(clientNumber++));
  assert.equal(unsafe.json.redone, false);
  assert.deepEqual(
    (await state(collaboratorMap.id)).objects.find((object: any) => object.id === collaborative.id)?.x,
    99,
  );

  const unrelatedMap = await createMap('Redo Unrelated World');
  const own = markerObject(40, 1, 1);
  await createObject(unrelatedMap.id, actorA, own);
  await undo(unrelatedMap.id, actorA);
  await createObject(unrelatedMap.id, actorB, markerObject(41, 2, 2));
  const unrelatedRedo = await redo(unrelatedMap.id, actorA, id(clientNumber++));
  assert.equal(unrelatedRedo.json.redone, true);

  const operationColumns = database.prepare('PRAGMA table_info(map_operations)').all() as Array<{ name: string }>;
  assert.ok(operationColumns.some((column) => column.name === 'redo_of_operation_id'));
  assert.ok(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'map_operations_redo_target_unique'")
      .get(),
  );
  const links = database
    .prepare('SELECT undo_of_operation_id, redo_of_operation_id FROM map_operations WHERE map_id = ?')
    .all(map.id) as Array<{ undo_of_operation_id: string | null; redo_of_operation_id: string | null }>;
  assert.ok(links.some((operation) => operation.undo_of_operation_id !== null));
  assert.ok(links.some((operation) => operation.redo_of_operation_id !== null));

  console.log('Redo verification passed');
} finally {
  await app.close();
  database.close();
  rmSync(directory, { recursive: true, force: true });
}

async function createMap(name: string): Promise<{ id: string }> {
  const response = await request('POST', '/api/maps', { name });
  assert.equal(response.statusCode, 201);
  return response.json.map;
}

async function createObject(mapId: string, actorId: string, object: any): Promise<void> {
  const response = await request('POST', `/api/maps/${mapId}/objects`, mutation(actorId, object));
  assert.ok(response.statusCode === 201 || response.statusCode === 200);
}

async function updateObject(mapId: string, actorId: string, object: any, baseObjectVersion: number): Promise<void> {
  const response = await request('PUT', `/api/maps/${mapId}/objects/${object.id}`, {
    ...mutation(actorId),
    baseObjectVersion,
    object,
  });
  assert.equal(response.statusCode, 200);
}

async function undo(mapId: string, actorId: string): Promise<any> {
  return request('POST', `/api/maps/${mapId}/undo`, mutation(actorId));
}

async function redo(mapId: string, actorId: string, clientOperationId: string): Promise<any> {
  return request('POST', `/api/maps/${mapId}/redo`, { actorId, clientOperationId });
}

async function state(mapId: string): Promise<any> {
  const response = await request('GET', `/api/maps/${mapId}`);
  assert.equal(response.statusCode, 200);
  return response.json;
}

async function request(method: string, url: string, body?: unknown): Promise<any> {
  const response = await app.inject({ method, url, payload: body });
  return { statusCode: response.statusCode, json: response.body === '' ? null : JSON.parse(response.body) };
}

function mutation(actorId: string, object?: unknown) {
  return { actorId, clientOperationId: id(clientNumber++), ...(object === undefined ? {} : { object }) };
}

function lifecycle(actorId: string, baseObjectVersion: number) {
  return { ...mutation(actorId), baseObjectVersion };
}

function markerObject(number: number, x: number, y: number) {
  return {
    id: id(number),
    objectType: 'marker',
    markerType: 'home',
    x,
    y,
    name: null,
    note: null,
    sizeScale: 1,
    directionDegrees: null,
  };
}

function id(number: number): string {
  return `00000000-0000-4000-8000-${number.toString(12).padStart(12, '0')}`;
}

function applyMigrations(database: Database.Database, migrationsToApply: readonly Migration[]): void {
  for (const migration of migrationsToApply) {
    database.transaction(() => {
      migration.up(database);
      database.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    })();
  }
}
