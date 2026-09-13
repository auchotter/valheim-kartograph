import type { Biome, BiomeStroke, Id, Path, PathGeometryType, WorldPoint } from '../../../shared/domain';
import { requestJson } from './http';

export interface BiomeStrokeCreate {
  id: Id;
  objectType: 'biome_stroke';
  mode: 'paint' | 'erase';
  biome: Biome | null;
  brushWidth: number;
  points: WorldPoint[];
}

interface CreateObjectResponse {
  object: BiomeStroke;
  mapRevision: number;
  idempotent: boolean;
}

interface PathMutationResponse {
  object: Path;
  mapRevision: number;
  idempotent: boolean;
}

export interface PathCreate {
  id: Id;
  objectType: 'path';
  pathType: 'path';
  geometryType: PathGeometryType;
  strokeWidth: number;
  points: WorldPoint[];
}

export async function createBiomeStroke(
  mapId: Id,
  actorId: Id,
  clientOperationId: Id,
  object: BiomeStrokeCreate,
): Promise<CreateObjectResponse> {
  return requestJson(`/api/maps/${mapId}/objects`, {
    method: 'POST',
    body: JSON.stringify({ actorId, clientOperationId, object }),
  });
}

export async function createPath(
  mapId: Id,
  actorId: Id,
  clientOperationId: Id,
  object: PathCreate,
): Promise<PathMutationResponse> {
  return requestJson(`/api/maps/${mapId}/objects`, {
    method: 'POST',
    body: JSON.stringify({ actorId, clientOperationId, object }),
  });
}

export async function updatePath(
  mapId: Id,
  actorId: Id,
  clientOperationId: Id,
  baseObjectVersion: number,
  object: Path,
): Promise<PathMutationResponse> {
  return requestJson(`/api/maps/${mapId}/objects/${object.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      actorId,
      clientOperationId,
      baseObjectVersion,
      object: {
        id: object.id,
        objectType: 'path',
        pathType: object.pathType,
        geometryType: object.geometryType,
        strokeWidth: object.strokeWidth,
        points: object.points,
      },
    }),
  });
}

export async function deletePath(
  mapId: Id,
  actorId: Id,
  clientOperationId: Id,
  objectId: Id,
  baseObjectVersion: number,
): Promise<PathMutationResponse> {
  return requestJson(`/api/maps/${mapId}/objects/${objectId}`, {
    method: 'DELETE',
    body: JSON.stringify({ actorId, clientOperationId, baseObjectVersion }),
  });
}
