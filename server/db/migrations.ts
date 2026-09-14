import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (database: Database.Database) => void;
}

// Add future application schema changes here in ascending version order.
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema_version',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    },
  },
  {
    version: 2,
    name: 'initial_map_schema',
    up(database) {
      database.exec(`
        CREATE TABLE maps (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
          next_order_key INTEGER NOT NULL DEFAULT 0 CHECK (next_order_key >= 0),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT
        );

        CREATE TABLE map_objects (
          id TEXT PRIMARY KEY,
          map_id TEXT NOT NULL,
          object_type TEXT NOT NULL CHECK (object_type IN ('biome_stroke', 'path', 'marker', 'label')),
          layer INTEGER NOT NULL CHECK (layer IN (0, 100, 200, 300)),
          order_key INTEGER NOT NULL CHECK (order_key >= 0),
          object_version INTEGER NOT NULL DEFAULT 1 CHECK (object_version > 0),
          min_x REAL NOT NULL,
          min_y REAL NOT NULL,
          max_x REAL NOT NULL,
          max_y REAL NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT,
          CHECK (min_x <= max_x),
          CHECK (min_y <= max_y),
          FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
        );

        CREATE TABLE biome_strokes (
          object_id TEXT PRIMARY KEY,
          mode TEXT NOT NULL CHECK (mode IN ('paint', 'erase')),
          biome TEXT CHECK (
            biome IS NULL OR biome IN (
              'meadows', 'black_forest', 'swamp', 'mountains', 'plains',
              'mistlands', 'ashlands', 'deep_north', 'ocean'
            )
          ),
          brush_width REAL NOT NULL CHECK (brush_width > 0),
          points_json TEXT NOT NULL CHECK (json_valid(points_json)),
          point_count INTEGER NOT NULL CHECK (point_count > 0),
          CHECK (
            (mode = 'paint' AND biome IS NOT NULL) OR
            (mode = 'erase' AND biome IS NULL)
          ),
          FOREIGN KEY (object_id) REFERENCES map_objects(id) ON DELETE CASCADE
        );

        CREATE TABLE paths (
          object_id TEXT PRIMARY KEY,
          path_type TEXT NOT NULL CHECK (path_type IN ('road', 'river', 'sailing_route')),
          stroke_width REAL NOT NULL CHECK (stroke_width > 0),
          points_json TEXT NOT NULL CHECK (json_valid(points_json)),
          point_count INTEGER NOT NULL CHECK (point_count > 0),
          FOREIGN KEY (object_id) REFERENCES map_objects(id) ON DELETE CASCADE
        );

        CREATE TABLE markers (
          object_id TEXT PRIMARY KEY,
          marker_type TEXT NOT NULL CHECK (length(trim(marker_type)) > 0),
          x REAL NOT NULL,
          y REAL NOT NULL,
          name TEXT,
          note TEXT,
          FOREIGN KEY (object_id) REFERENCES map_objects(id) ON DELETE CASCADE
        );

        CREATE TABLE labels (
          object_id TEXT PRIMARY KEY,
          x REAL NOT NULL,
          y REAL NOT NULL,
          text TEXT NOT NULL CHECK (length(trim(text)) > 0),
          font_size REAL NOT NULL DEFAULT 16 CHECK (font_size > 0),
          FOREIGN KEY (object_id) REFERENCES map_objects(id) ON DELETE CASCADE
        );

        CREATE TABLE map_operations (
          id TEXT PRIMARY KEY,
          map_id TEXT NOT NULL,
          map_revision INTEGER NOT NULL CHECK (map_revision > 0),
          actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
          client_operation_id TEXT NOT NULL CHECK (length(trim(client_operation_id)) > 0),
          operation_type TEXT NOT NULL CHECK (length(trim(operation_type)) > 0),
          object_id TEXT,
          base_object_version INTEGER CHECK (
            base_object_version IS NULL OR base_object_version > 0
          ),
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX maps_active_name_unique
          ON maps(name COLLATE NOCASE)
          WHERE deleted_at IS NULL;

        CREATE INDEX maps_active_updated
          ON maps(deleted_at, updated_at DESC);

        CREATE INDEX map_objects_render_order
          ON map_objects(map_id, deleted_at, layer, order_key);

        CREATE INDEX map_objects_by_type
          ON map_objects(map_id, object_type, deleted_at);

        CREATE UNIQUE INDEX map_operations_revision_unique
          ON map_operations(map_id, map_revision);

        CREATE UNIQUE INDEX map_operations_idempotency_unique
          ON map_operations(map_id, actor_id, client_operation_id);
      `);
    },
  },
  {
    version: 3,
    name: 'prepare_markers_paths_and_lava_biome',
    up(database) {
      // SQLite cannot alter an existing CHECK constraint. Rebuild these small
      // subtype tables inside the migration transaction, copying every row.
      database.exec(`
        CREATE TABLE biome_strokes_migration_3 (
          object_id TEXT PRIMARY KEY,
          mode TEXT NOT NULL CHECK (mode IN ('paint', 'erase')),
          biome TEXT CHECK (
            biome IS NULL OR biome IN (
              'meadows', 'black_forest', 'swamp', 'mountains', 'plains',
              'mistlands', 'ashlands', 'lava', 'deep_north', 'ocean'
            )
          ),
          brush_width REAL NOT NULL CHECK (brush_width > 0),
          points_json TEXT NOT NULL CHECK (json_valid(points_json)),
          point_count INTEGER NOT NULL CHECK (point_count > 0),
          CHECK (
            (mode = 'paint' AND biome IS NOT NULL) OR
            (mode = 'erase' AND biome IS NULL)
          ),
          FOREIGN KEY (object_id) REFERENCES map_objects(id) ON DELETE CASCADE
        );

        INSERT INTO biome_strokes_migration_3 (
          object_id, mode, biome, brush_width, points_json, point_count
        )
        SELECT object_id, mode, biome, brush_width, points_json, point_count
        FROM biome_strokes;

        DROP TABLE biome_strokes;
        ALTER TABLE biome_strokes_migration_3 RENAME TO biome_strokes;

        CREATE TABLE paths_migration_3 (
          object_id TEXT PRIMARY KEY,
          path_type TEXT NOT NULL CHECK (path_type IN ('path', 'road', 'river', 'sailing_route')),
          geometry_type TEXT NOT NULL CHECK (geometry_type IN ('freehand', 'straight', 'curve')),
          stroke_width REAL NOT NULL CHECK (stroke_width > 0),
          points_json TEXT NOT NULL CHECK (json_valid(points_json)),
          point_count INTEGER NOT NULL CHECK (point_count > 0),
          FOREIGN KEY (object_id) REFERENCES map_objects(id) ON DELETE CASCADE
        );

        INSERT INTO paths_migration_3 (
          object_id, path_type, geometry_type, stroke_width, points_json, point_count
        )
        SELECT object_id, path_type, 'freehand', stroke_width, points_json, point_count
        FROM paths;

        DROP TABLE paths;
        ALTER TABLE paths_migration_3 RENAME TO paths;

        ALTER TABLE markers
          ADD COLUMN size_scale REAL NOT NULL DEFAULT 1 CHECK (size_scale > 0 AND size_scale <= 10);

        ALTER TABLE markers
          ADD COLUMN direction_degrees REAL CHECK (
            direction_degrees IS NULL OR
            (direction_degrees >= 0 AND direction_degrees < 360)
          );
      `);
    },
  },
  {
    version: 4,
    name: 'add_undo_operation_links',
    up(database) {
      database.exec(`
        ALTER TABLE map_operations
          ADD COLUMN undo_of_operation_id TEXT REFERENCES map_operations(id);

        CREATE UNIQUE INDEX map_operations_undo_target_unique
          ON map_operations(undo_of_operation_id)
          WHERE undo_of_operation_id IS NOT NULL;

        CREATE INDEX map_operations_actor_history
          ON map_operations(map_id, actor_id, map_revision DESC);
      `);
    },
  },
  {
    version: 5,
    name: 'add_redo_operation_links',
    up(database) {
      database.exec(`
        ALTER TABLE map_operations
          ADD COLUMN redo_of_operation_id TEXT REFERENCES map_operations(id);

        CREATE UNIQUE INDEX map_operations_redo_target_unique
          ON map_operations(redo_of_operation_id)
          WHERE redo_of_operation_id IS NOT NULL;
      `);
    },
  },
];
