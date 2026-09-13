import type { MapObject } from '../../shared/domain.js';
import type { MapObjectAcceptedMessage } from '../../shared/realtime.js';
import type { ObjectMutationResult } from '../services/mapService.js';

const operationTypes = new Set<MapObjectAcceptedMessage['operationType']>([
  'object.create',
  'object.update',
  'object.delete',
  'object.restore',
]);

export function acceptedMutationEvent(result: ObjectMutationResult): MapObjectAcceptedMessage {
  const operation = result.operation;
  if (!operationTypes.has(operation.operationType as MapObjectAcceptedMessage['operationType'])) {
    throw new Error(`Unsupported realtime operation type: ${operation.operationType}`);
  }
  if (operation.objectId === null) {
    throw new Error('Object mutation operation is missing its object ID.');
  }

  const payload = operation.payload as { before: MapObject | null; after: MapObject | null };
  if ((payload.before !== null && !isMapObject(payload.before)) || (payload.after !== null && !isMapObject(payload.after))) {
    throw new Error('Object mutation payload is not a valid map-object state.');
  }
  const source = payload.after ?? payload.before;
  if (source === null || !isMapObject(source)) {
    throw new Error('Object mutation operation is missing its object type.');
  }

  return {
    type: 'map.object.accepted',
    mapId: operation.mapId,
    revision: operation.mapRevision,
    operationId: operation.id,
    actorId: operation.actorId,
    clientOperationId: operation.clientOperationId,
    operationType: operation.operationType as MapObjectAcceptedMessage['operationType'],
    objectId: operation.objectId,
    objectType: source.objectType,
    baseObjectVersion: operation.baseObjectVersion,
    createdAt: operation.createdAt,
    payload,
  };
}

function isMapObject(value: unknown): value is MapObject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const object = value as Partial<MapObject>;
  return typeof object.id === 'string' && typeof object.mapId === 'string' && object.objectType !== undefined;
}
