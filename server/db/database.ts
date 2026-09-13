import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from './migrations.js';

/**
 * Docker explicitly supplies /data/valheim-map.sqlite. Without that override,
 * keep local development data inside the repository rather than requiring a
 * root-level production mount on the developer machine.
 */
function resolvedDatabasePath(): string {
  return process.env.DATABASE_PATH ?? resolve(process.cwd(), 'data', 'valheim-map.sqlite');
}

export function openDatabase(): Database.Database {
  const databasePath = resolvedDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  runMigrations(database);
  return database;
}

function runMigrations(database: Database.Database): void {
  for (const migration of migrations) {
    const migrationTableExists = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();

    if (migrationTableExists === undefined) {
      database.transaction(() => {
        migration.up(database);
        database
          .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
          .run(migration.version, migration.name);
      })();
      continue;
    }

    const existing = database
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(migration.version);

    if (existing === undefined) {
      database.transaction(() => {
        migration.up(database);
        database
          .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
          .run(migration.version, migration.name);
      })();
    }
  }
}
