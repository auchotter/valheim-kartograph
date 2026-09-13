import type { Biome, BiomeStroke, Id, WorldPoint } from '../../../shared/domain';
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
