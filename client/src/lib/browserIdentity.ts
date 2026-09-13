import type { Id } from '../../../shared/domain';

const ACTOR_ID_KEY = 'valheim-map.actor-id';
const CURRENT_MAP_ID_KEY = 'valheim-map.current-map-id';
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function actorId(): Id {
  return getOrCreateUuid(ACTOR_ID_KEY);
}

export function rememberedMapId(): Id | null {
  return window.localStorage.getItem(CURRENT_MAP_ID_KEY);
}

export function rememberMapId(mapId: Id): void {
  window.localStorage.setItem(CURRENT_MAP_ID_KEY, mapId);
}

function getOrCreateUuid(key: string): Id {
  const existing = window.localStorage.getItem(key);
  if (existing !== null && UUID_V4_PATTERN.test(existing)) {
    return existing;
  }
  const value = crypto.randomUUID();
  window.localStorage.setItem(key, value);
  return value;
}
