import type { MapObject, MapRecord } from '../../../shared/domain';
import { requestJson } from './http';

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
