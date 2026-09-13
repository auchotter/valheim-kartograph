import type Database from 'better-sqlite3';
import type {
  BiomeStroke,
  BoundingBox,
  Label,
  MapObject,
  MapOperation,
  MapRecord,
  Marker,
  Path,
  WorldPoint,
} from '../../shared/domain.js';

interface MapRow {
  id: string;
  name: string;
  revision: number;
  next_order_key: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ObjectRow extends MapRow {
  map_id: string;
  object_type: MapObject['objectType'];
  layer: number;
  order_key: number;
  object_version: number;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  biome_mode: 'paint' | 'erase' | null;
  biome: string | null;
  brush_width: number | null;
  biome_points_json: string | null;
  path_type: string | null;
  geometry_type: string | null;
  stroke_width: number | null;
  path_points_json: string | null;
  marker_type: string | null;
  marker_x: number | null;
  marker_y: number | null;
  marker_name: string | null;
  marker_note: string | null;
  size_scale: number | null;
  direction_degrees: number | null;
  label_x: number | null;
  label_y: number | null;
  label_text: string | null;
  font_size: number | null;
}

interface OperationRow {
  id: string;
  map_id: string;
  map_revision: number;
  actor_id: string;
  client_operation_id: string;
  operation_type: string;
  object_id: string | null;
  base_object_version: number | null;
  payload_json: string;
  created_at: string;
}

const objectSelect = `
  SELECT
    mo.id, mo.map_id, mo.object_type, mo.layer, mo.order_key, mo.object_version,
    mo.min_x, mo.min_y, mo.max_x, mo.max_y, mo.created_at, mo.updated_at, mo.deleted_at,
    bs.mode AS biome_mode, bs.biome, bs.brush_width, bs.points_json AS biome_points_json,
    p.path_type, p.geometry_type, p.stroke_width, p.points_json AS path_points_json,
    mr.marker_type, mr.x AS marker_x, mr.y AS marker_y, mr.name AS marker_name,
    mr.note AS marker_note, mr.size_scale, mr.direction_degrees,
    l.x AS label_x, l.y AS label_y, l.text AS label_text, l.font_size
  FROM map_objects mo
  LEFT JOIN biome_strokes bs ON bs.object_id = mo.id
  LEFT JOIN paths p ON p.object_id = mo.id
  LEFT JOIN markers mr ON mr.object_id = mo.id
  LEFT JOIN labels l ON l.object_id = mo.id
`;

export class MapRepository {
  constructor(private readonly database: Database.Database) {}

  transaction<T>(work: () => T): T {
    return this.database.transaction(work)();
  }

  listActiveMaps(): MapRecord[] {
    return (this.database
      .prepare('SELECT * FROM maps WHERE deleted_at IS NULL ORDER BY updated_at DESC, name COLLATE NOCASE ASC')
      .all() as MapRow[]).map(toMapRecord);
  }

  findMap(mapId: string, includeDeleted = false): MapRecord | null {
    const row = this.database
      .prepare(`SELECT * FROM maps WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`)
      .get(mapId) as MapRow | undefined;
    return row === undefined ? null : toMapRecord(row);
  }

  activeMapNameExists(name: string, exceptMapId?: string): boolean {
    const row = this.database
      .prepare(
        `SELECT 1 FROM maps
         WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL ${exceptMapId === undefined ? '' : 'AND id != ?'}`,
      )
      .get(...(exceptMapId === undefined ? [name] : [name, exceptMapId]));
    return row !== undefined;
  }

  insertMap(map: MapRecord): void {
    this.database
      .prepare(
        `INSERT INTO maps (id, name, revision, next_order_key, created_at, updated_at, deleted_at)
         VALUES (@id, @name, @revision, @nextOrderKey, @createdAt, @updatedAt, @deletedAt)`,
      )
      .run(map);
  }

  renameMap(mapId: string, name: string, updatedAt: string): void {
    this.database.prepare('UPDATE maps SET name = ?, updated_at = ? WHERE id = ?').run(name, updatedAt, mapId);
  }

  softDeleteMap(mapId: string, deletedAt: string): void {
    this.database.prepare('UPDATE maps SET deleted_at = ?, updated_at = ? WHERE id = ?').run(deletedAt, deletedAt, mapId);
  }

  allocateOrderKey(mapId: string): number {
    const row = this.database.prepare('SELECT next_order_key FROM maps WHERE id = ?').get(mapId) as
      | { next_order_key: number }
      | undefined;
    if (row === undefined) {
      throw new Error('Cannot allocate an order key for a missing map.');
    }
    this.database.prepare('UPDATE maps SET next_order_key = next_order_key + 1 WHERE id = ?').run(mapId);
    return row.next_order_key;
  }

  updateMapRevision(mapId: string, updatedAt: string): number {
    const row = this.database
      .prepare('UPDATE maps SET revision = revision + 1, updated_at = ? WHERE id = ? RETURNING revision')
      .get(updatedAt, mapId) as { revision: number } | undefined;
    if (row === undefined) {
      throw new Error('Cannot update the revision of a missing map.');
    }
    return row.revision;
  }

  listObjects(mapId: string, includeDeleted = false): MapObject[] {
    const rows = this.database
      .prepare(
        `${objectSelect}
         WHERE mo.map_id = ? ${includeDeleted ? '' : 'AND mo.deleted_at IS NULL'}
         ORDER BY mo.layer ASC, mo.order_key ASC`,
      )
      .all(mapId) as ObjectRow[];
    return rows.map(toMapObject);
  }

  findObject(mapId: string, objectId: string, includeDeleted = false): MapObject | null {
    const row = this.database
      .prepare(
        `${objectSelect}
         WHERE mo.map_id = ? AND mo.id = ? ${includeDeleted ? '' : 'AND mo.deleted_at IS NULL'}`,
      )
      .get(mapId, objectId) as ObjectRow | undefined;
    return row === undefined ? null : toMapObject(row);
  }

  insertObject(object: MapObject): void {
    this.database
      .prepare(
        `INSERT INTO map_objects (
          id, map_id, object_type, layer, order_key, object_version,
          min_x, min_y, max_x, max_y, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        object.id,
        object.mapId,
        object.objectType,
        object.layer,
        object.orderKey,
        object.objectVersion,
        object.minX,
        object.minY,
        object.maxX,
        object.maxY,
        object.createdAt,
        object.updatedAt,
        object.deletedAt,
      );
    this.writeSubtype(object);
  }

  updateObject(object: MapObject): void {
    this.database
      .prepare(
        `UPDATE map_objects SET object_version = ?, min_x = ?, min_y = ?, max_x = ?, max_y = ?,
         updated_at = ?, deleted_at = ? WHERE id = ? AND map_id = ?`,
      )
      .run(
        object.objectVersion,
        object.minX,
        object.minY,
        object.maxX,
        object.maxY,
        object.updatedAt,
        object.deletedAt,
        object.id,
        object.mapId,
      );
    this.deleteSubtype(object.id);
    this.writeSubtype(object);
  }

  setObjectDeleted(
    mapId: string,
    objectId: string,
    objectVersion: number,
    deletedAt: string | null,
    updatedAt: string,
  ): void {
    this.database
      .prepare(
        `UPDATE map_objects SET object_version = ?, deleted_at = ?, updated_at = ?
         WHERE map_id = ? AND id = ?`,
      )
      .run(objectVersion, deletedAt, updatedAt, mapId, objectId);
  }

  findOperation(mapId: string, actorId: string, clientOperationId: string): MapOperation | null {
    const row = this.database
      .prepare(
        `SELECT * FROM map_operations
         WHERE map_id = ? AND actor_id = ? AND client_operation_id = ?`,
      )
      .get(mapId, actorId, clientOperationId) as OperationRow | undefined;
    return row === undefined ? null : toMapOperation(row);
  }

  insertOperation(operation: MapOperation): void {
    this.database
      .prepare(
        `INSERT INTO map_operations (
          id, map_id, map_revision, actor_id, client_operation_id, operation_type,
          object_id, base_object_version, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        operation.id,
        operation.mapId,
        operation.mapRevision,
        operation.actorId,
        operation.clientOperationId,
        operation.operationType,
        operation.objectId,
        operation.baseObjectVersion,
        JSON.stringify(operation.payload),
        operation.createdAt,
      );
  }

  private writeSubtype(object: MapObject): void {
    if (object.objectType === 'biome_stroke') {
      this.database
        .prepare(
          `INSERT INTO biome_strokes (object_id, mode, biome, brush_width, points_json, point_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(object.id, object.mode, object.biome, object.brushWidth, JSON.stringify(object.points), object.points.length);
      return;
    }
    if (object.objectType === 'path') {
      this.database
        .prepare(
          `INSERT INTO paths (object_id, path_type, geometry_type, stroke_width, points_json, point_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          object.id,
          object.pathType,
          object.geometryType,
          object.strokeWidth,
          JSON.stringify(object.points),
          object.points.length,
        );
      return;
    }
    if (object.objectType === 'marker') {
      this.database
        .prepare(
          `INSERT INTO markers (
            object_id, marker_type, x, y, name, note, size_scale, direction_degrees
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          object.id,
          object.markerType,
          object.x,
          object.y,
          object.name,
          object.note,
          object.sizeScale,
          object.directionDegrees,
        );
      return;
    }
    this.database
      .prepare('INSERT INTO labels (object_id, x, y, text, font_size) VALUES (?, ?, ?, ?, ?)')
      .run(object.id, object.x, object.y, object.text, object.fontSize);
  }

  private deleteSubtype(objectId: string): void {
    this.database.prepare('DELETE FROM biome_strokes WHERE object_id = ?').run(objectId);
    this.database.prepare('DELETE FROM paths WHERE object_id = ?').run(objectId);
    this.database.prepare('DELETE FROM markers WHERE object_id = ?').run(objectId);
    this.database.prepare('DELETE FROM labels WHERE object_id = ?').run(objectId);
  }
}

function toMapRecord(row: MapRow): MapRecord {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    nextOrderKey: row.next_order_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toBase(row: ObjectRow): Omit<MapObject, 'objectType'> {
  return {
    id: row.id,
    mapId: row.map_id,
    layer: row.layer,
    orderKey: row.order_key,
    objectVersion: row.object_version,
    minX: row.min_x,
    minY: row.min_y,
    maxX: row.max_x,
    maxY: row.max_y,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  } as Omit<MapObject, 'objectType'>;
}

function toMapObject(row: ObjectRow): MapObject {
  const base = toBase(row);
  if (row.object_type === 'biome_stroke') {
    return {
      ...base,
      objectType: 'biome_stroke',
      mode: required(row.biome_mode),
      biome: row.biome as BiomeStroke['biome'],
      brushWidth: required(row.brush_width),
      points: parsePoints(required(row.biome_points_json)),
    } as BiomeStroke;
  }
  if (row.object_type === 'path') {
    return {
      ...base,
      objectType: 'path',
      pathType: required(row.path_type) as Path['pathType'],
      geometryType: required(row.geometry_type) as Path['geometryType'],
      strokeWidth: required(row.stroke_width),
      points: parsePoints(required(row.path_points_json)),
    } as Path;
  }
  if (row.object_type === 'marker') {
    return {
      ...base,
      objectType: 'marker',
      markerType: required(row.marker_type),
      x: required(row.marker_x),
      y: required(row.marker_y),
      name: row.marker_name,
      note: row.marker_note,
      sizeScale: required(row.size_scale),
      directionDegrees: row.direction_degrees,
    } as Marker;
  }
  return {
    ...base,
    objectType: 'label',
    x: required(row.label_x),
    y: required(row.label_y),
    text: required(row.label_text),
    fontSize: required(row.font_size),
  } as Label;
}

function toMapOperation(row: OperationRow): MapOperation {
  return {
    id: row.id,
    mapId: row.map_id,
    mapRevision: row.map_revision,
    actorId: row.actor_id,
    clientOperationId: row.client_operation_id,
    operationType: row.operation_type,
    objectId: row.object_id,
    baseObjectVersion: row.base_object_version,
    payload: JSON.parse(row.payload_json) as MapOperation['payload'],
    createdAt: row.created_at,
  };
}

function parsePoints(pointsJson: string): WorldPoint[] {
  return JSON.parse(pointsJson) as WorldPoint[];
}

function required<T>(value: T | null): T {
  if (value === null) {
    throw new Error('Stored map object is missing its subtype data.');
  }
  return value;
}
