import type { MapObject } from './domain.js';

export type AcceptedObjectOperationType =
  | 'object.create'
  | 'object.update'
  | 'object.delete'
  | 'object.restore';

export interface MapReadyMessage {
  type: 'map.ready';
  mapId: string;
  revision: number;
}

export interface MapUnavailableMessage {
  type: 'map.unavailable';
  mapId: string;
}

export interface MapObjectAcceptedMessage {
  type: 'map.object.accepted';
  mapId: string;
  revision: number;
  operationId: string;
  actorId: string;
  clientOperationId: string;
  operationType: AcceptedObjectOperationType;
  objectId: string;
  objectType: MapObject['objectType'];
  baseObjectVersion: number | null;
  createdAt: string;
  payload: {
    before: MapObject | null;
    after: MapObject | null;
  };
}

export type RealtimeServerMessage =
  | MapReadyMessage
  | MapUnavailableMessage
  | MapObjectAcceptedMessage;
