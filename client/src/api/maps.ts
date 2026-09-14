import type { Id, MapObject, MapRecord } from '../../../shared/domain';
import { requestEmpty, requestJson } from './http';

export async function listMaps(): Promise<MapRecord[]> {
  return (await requestJson<{ maps: MapRecord[] }>('/api/maps')).maps;
}

export async function createMap(name: string): Promise<MapRecord> {
  return (await requestJson<{ map: MapRecord }>('/api/maps', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })).map;
}

export async function loadMapState(mapId: string): Promise<{ map: MapRecord; objects: MapObject[] }> {
  return requestJson(`/api/maps/${mapId}`);
}

export async function renameMap(mapId: Id, name: string): Promise<MapRecord> {
  return (await requestJson<{ map: MapRecord }>(`/api/maps/${mapId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })).map;
}

export async function duplicateMap(mapId: Id, name: string): Promise<MapRecord> {
  return (await requestJson<{ map: MapRecord }>(`/api/maps/${mapId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })).map;
}

export async function deleteMap(mapId: Id): Promise<void> {
  await requestEmpty(`/api/maps/${mapId}`, { method: 'DELETE' });
}

export interface UndoMapResponse {
  undone: boolean;
  reason?: 'empty';
  targetOperationId?: Id;
  inverseOperationId?: Id;
  mapRevision?: number;
  objectType?: MapObject['objectType'];
  objectId?: Id;
  action?: string;
  idempotent: boolean;
}

export async function undoMap(mapId: Id, actorId: Id, clientOperationId: Id): Promise<UndoMapResponse> {
  return requestJson(`/api/maps/${mapId}/undo`, {
    method: 'POST',
    body: JSON.stringify({ actorId, clientOperationId }),
  });
}

export interface RedoMapResponse {
  redone: boolean;
  reason?: 'empty';
  targetOperationId?: Id;
  redoOperationId?: Id;
  mapRevision?: number;
  objectType?: MapObject['objectType'];
  objectId?: Id;
  action?: string;
  idempotent: boolean;
}

export async function redoMap(mapId: Id, actorId: Id, clientOperationId: Id): Promise<RedoMapResponse> {
  return requestJson(`/api/maps/${mapId}/redo`, {
    method: 'POST',
    body: JSON.stringify({ actorId, clientOperationId }),
  });
}
