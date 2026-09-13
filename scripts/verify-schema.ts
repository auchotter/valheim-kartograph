import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../server/app.ts';
import { migrations, type Migration } from '../server/db/migrations.ts';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'valheim-map-schema-'));

try {
  const freshDatabase = openTemporaryDatabase('fresh.sqlite');
  applyMigrations(freshDatabase, migrations);
  verifyFreshSchema(freshDatabase);
  await verifyHealthEndpoint(freshDatabase);
  freshDatabase.close();

  const migrationTwoDatabase = openTemporaryDatabase('migration-two.sqlite');
  applyMigrations(migrationTwoDatabase, migrations.filter((migration) => migration.version <= 2));
  seedMigrationTwoData(migrationTwoDatabase);
  applyMigrations(migrationTwoDatabase, migrations.filter((migration) => migration.version === 3));
  verifyMigratedData(migrationTwoDatabase);
  migrationTwoDatabase.close();

  console.log('Schema migrations and constraints verification passed');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function openTemporaryDatabase(filename: string): Database.Database {
  const database = new Database(join(temporaryDirectory, filename));
  database.pragma('foreign_keys = ON');
  return database;
}

function applyMigrations(database: Database.Database, migrationsToApply: readonly Migration[]): void {
  for (const migration of migrationsToApply) {
    database.transaction(() => {
      migration.up(database);
      database
        .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name);
    })();
  }
}

function verifyFreshSchema(database: Database.Database): void {
  const tableNames = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    tableNames.map(({ name }) => name),
    [
      'biome_strokes',
      'labels',
      'map_objects',
      'map_operations',
      'maps',
      'markers',
      'paths',
      'schema_migrations',
    ],
  );
  assert.equal(database.pragma('foreign_keys', { simple: true }), 1);

  insertMap(database);
  insertObject(database, 'lava-stroke', 'biome_stroke', 0, 1);
  database
    .prepare(
      `INSERT INTO biome_strokes (object_id, mode, biome, brush_width, points_json, point_count)
       VALUES (?, 'paint', 'lava', 24, '[[0,0]]', 1)`,
    )
    .run('lava-stroke');

  insertObject(database, 'invalid-biome', 'biome_stroke', 0, 2);
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO biome_strokes (object_id, mode, biome, brush_width, points_json, point_count)
           VALUES (?, 'paint', 'volcano', 24, '[[0,0]]', 1)`,
        )
        .run('invalid-biome'),
  );

  insertObject(database, 'marker-default', 'marker', 200, 3);
  database.prepare("INSERT INTO markers (object_id, marker_type, x, y) VALUES ('marker-default', 'home', 1, 2)").run();
  assert.deepEqual(
    database.prepare('SELECT size_scale, direction_degrees FROM markers WHERE object_id = ?').get('marker-default'),
    { size_scale: 1, direction_degrees: null },
  );

  for (const [id, sizeScale] of [
    ['marker-zero', 0],
    ['marker-negative', -0.5],
  ] as const) {
    insertObject(database, id, 'marker', 200, 4);
    assert.throws(() =>
      database
        .prepare('INSERT INTO markers (object_id, marker_type, x, y, size_scale) VALUES (?, \'home\', 0, 0, ?)')
        .run(id, sizeScale),
    );
  }

  insertObject(database, 'marker-direction', 'marker', 200, 5);
  database
    .prepare("INSERT INTO markers (object_id, marker_type, x, y, direction_degrees) VALUES ('marker-direction', 'vegvisir', 0, 0, 359.9)")
    .run();
  for (const [id, direction] of [
    ['marker-direction-negative', -0.01],
    ['marker-direction-360', 360],
  ] as const) {
    insertObject(database, id, 'marker', 200, 6);
    assert.throws(() =>
      database
        .prepare(
          "INSERT INTO markers (object_id, marker_type, x, y, direction_degrees) VALUES (?, 'vegvisir', 0, 0, ?)",
        )
        .run(id, direction),
    );
  }

  for (const [id, geometryType] of [
    ['freehand-path', 'freehand'],
    ['straight-path', 'straight'],
    ['curve-path', 'curve'],
  ] as const) {
    insertObject(database, id, 'path', 100, 10);
    database
      .prepare(
        "INSERT INTO paths (object_id, path_type, geometry_type, stroke_width, points_json, point_count) VALUES (?, 'path', ?, 3, '[[0,0],[1,1],[2,2]]', 3)",
      )
      .run(id, geometryType);
  }

  insertObject(database, 'invalid-geometry', 'path', 100, 11);
  assert.throws(() =>
    database
      .prepare(
        "INSERT INTO paths (object_id, path_type, geometry_type, stroke_width, points_json, point_count) VALUES (?, 'path', 'arc', 3, '[[0,0]]', 1)",
      )
      .run('invalid-geometry'),
  );

  for (const [id, pathType] of [
    ['generic-path', 'path'],
    ['road-path', 'road'],
    ['river-path', 'river'],
    ['sailing-path', 'sailing_route'],
  ] as const) {
    insertObject(database, id, 'path', 100, 12);
    database
      .prepare(
        "INSERT INTO paths (object_id, path_type, geometry_type, stroke_width, points_json, point_count) VALUES (?, ?, 'freehand', 3, '[[0,0]]', 1)",
      )
      .run(id, pathType);
  }

  database.prepare("DELETE FROM map_objects WHERE id = 'generic-path'").run();
  assert.equal(database.prepare("SELECT 1 FROM paths WHERE object_id = 'generic-path'").get(), undefined);
  database.prepare("DELETE FROM map_objects WHERE id = 'lava-stroke'").run();
  assert.equal(database.prepare("SELECT 1 FROM biome_strokes WHERE object_id = 'lava-stroke'").get(), undefined);
  database.prepare("DELETE FROM map_objects WHERE id = 'marker-default'").run();
  assert.equal(database.prepare("SELECT 1 FROM markers WHERE object_id = 'marker-default'").get(), undefined);

  insertObject(database, 'label-cascade', 'label', 300, 13);
  database.prepare("INSERT INTO labels (object_id, x, y, text) VALUES ('label-cascade', 0, 0, 'Label')").run();
  database.prepare("DELETE FROM map_objects WHERE id = 'label-cascade'").run();
  assert.equal(database.prepare("SELECT 1 FROM labels WHERE object_id = 'label-cascade'").get(), undefined);
}

function seedMigrationTwoData(database: Database.Database): void {
  insertMap(database);
  insertObject(database, 'existing-stroke', 'biome_stroke', 0, 1);
  database
    .prepare(
      "INSERT INTO biome_strokes (object_id, mode, biome, brush_width, points_json, point_count) VALUES ('existing-stroke', 'paint', 'meadows', 20, '[[0,0]]', 1)",
    )
    .run();
  insertObject(database, 'existing-path', 'path', 100, 2);
  database
    .prepare(
      "INSERT INTO paths (object_id, path_type, stroke_width, points_json, point_count) VALUES ('existing-path', 'road', 3, '[[0,0]]', 1)",
    )
    .run();
  insertObject(database, 'existing-marker', 'marker', 200, 3);
  database
    .prepare("INSERT INTO markers (object_id, marker_type, x, y, name) VALUES ('existing-marker', 'home', 4, 5, 'Old home')")
    .run();
}

function verifyMigratedData(database: Database.Database): void {
  assert.deepEqual(
    database.prepare('SELECT biome, brush_width FROM biome_strokes WHERE object_id = ?').get('existing-stroke'),
    { biome: 'meadows', brush_width: 20 },
  );
  assert.deepEqual(
    database.prepare('SELECT path_type, geometry_type FROM paths WHERE object_id = ?').get('existing-path'),
    { path_type: 'road', geometry_type: 'freehand' },
  );
  assert.deepEqual(
    database.prepare('SELECT size_scale, direction_degrees FROM markers WHERE object_id = ?').get('existing-marker'),
    { size_scale: 1, direction_degrees: null },
  );
}

function insertMap(database: Database.Database): void {
  database.prepare("INSERT INTO maps (id, name) VALUES ('map', 'Verification map')").run();
}

function insertObject(
  database: Database.Database,
  id: string,
  objectType: 'biome_stroke' | 'path' | 'marker' | 'label',
  layer: 0 | 100 | 200 | 300,
  orderKey: number,
): void {
  database
    .prepare(
      `INSERT INTO map_objects (
        id, map_id, object_type, layer, order_key, min_x, min_y, max_x, max_y
      ) VALUES (?, 'map', ?, ?, ?, 0, 0, 0, 0)`,
    )
    .run(id, objectType, layer, orderKey);
}

async function verifyHealthEndpoint(database: Database.Database): Promise<void> {
  const app = await createApp({ database });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok', database: 'available' });
  } finally {
    await app.close();
  }
}
