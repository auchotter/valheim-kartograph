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
