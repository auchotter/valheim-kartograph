import type { Id, Path, PathGeometryType, WorldPoint } from '../../../shared/domain';
import { MapLayer } from '../../../shared/domain';
import { strokeBoundingBox } from './strokeGeometry';

interface CreateOptimisticPathOptions {
  id: Id;
  mapId: Id;
  geometryType: PathGeometryType;
  strokeWidth: number;
  points: WorldPoint[];
}

/** A transient visual path replaced by the server-assigned authoritative object. */
export function createOptimisticPath({
  id,
  mapId,
  geometryType,
  strokeWidth,
  points,
}: CreateOptimisticPathOptions): Path {
  const now = new Date().toISOString();
  return {
    id,
    mapId,
    objectType: 'path',
    layer: MapLayer.Paths,
    // This only orders concurrent local previews. The server always replaces it.
    orderKey: Number.MAX_SAFE_INTEGER,
    objectVersion: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...strokeBoundingBox(points, strokeWidth),
    pathType: 'path',
    geometryType,
    strokeWidth,
    points,
  };
}
