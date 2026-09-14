export type MapAppearance = 'modern' | 'immersive';

export const MAP_APPEARANCE_STORAGE_KEY = 'valheim-map:appearance:v1';
export const MAP_APPEARANCE_VERSION = 1;
export const DEFAULT_MAP_APPEARANCE: MapAppearance = 'modern';

export interface MapAppearanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readMapAppearance(): MapAppearance {
  const storage = safeLocalStorage();
  if (storage === null) {
    return DEFAULT_MAP_APPEARANCE;
  }
  try {
    return readMapAppearanceFromStorage(storage);
  } catch {
    return DEFAULT_MAP_APPEARANCE;
  }
}

export function readMapAppearanceFromStorage(storage: MapAppearanceStorage): MapAppearance {
  try {
    return parseMapAppearance(storage.getItem(MAP_APPEARANCE_STORAGE_KEY));
  } catch {
    return DEFAULT_MAP_APPEARANCE;
  }
}

export function parseMapAppearance(raw: string | null): MapAppearance {
  if (raw === null) {
    return DEFAULT_MAP_APPEARANCE;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== MAP_APPEARANCE_VERSION || !isMapAppearance(value.mode)) {
      return DEFAULT_MAP_APPEARANCE;
    }
    return value.mode;
  } catch {
    return DEFAULT_MAP_APPEARANCE;
  }
}

export function writeMapAppearance(mode: MapAppearance): void {
  const storage = safeLocalStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(
      MAP_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ version: MAP_APPEARANCE_VERSION, mode }),
    );
  } catch {
    // Local storage is optional; the active in-memory mode remains authoritative.
  }
}

export function writeMapAppearanceToStorage(storage: MapAppearanceStorage, mode: MapAppearance): void {
  try {
    storage.setItem(
      MAP_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ version: MAP_APPEARANCE_VERSION, mode }),
    );
  } catch {
    // Storage can be unavailable or quota-restricted.
  }
}

function isMapAppearance(value: unknown): value is MapAppearance {
  return value === 'modern' || value === 'immersive';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeLocalStorage(): MapAppearanceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
