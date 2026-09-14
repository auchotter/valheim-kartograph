import type { PathOpacity } from './pathVisibility';

export const MAP_UI_PREFERENCES_STORAGE_KEY = 'valheim-map:ui:v1';
export const MAP_UI_PREFERENCES_VERSION = 1;

export interface MapUiPreferences {
  pathOpacity: PathOpacity;
  protectEnabled: boolean;
  gridEnabled: boolean;
}

export const DEFAULT_MAP_UI_PREFERENCES: MapUiPreferences = {
  pathOpacity: 1,
  protectEnabled: true,
  gridEnabled: false,
};

export interface MapUiStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readMapUiPreferences(): MapUiPreferences {
  const storage = safeLocalStorage();
  if (storage === null) {
    return { ...DEFAULT_MAP_UI_PREFERENCES };
  }

  try {
    return readMapUiPreferencesFromStorage(storage, safeSessionStorage());
  } catch {
    return { ...DEFAULT_MAP_UI_PREFERENCES };
  }
}

/**
 * Reads the durable preference store, migrating one valid record from the old
 * tab-scoped store only when the durable key is absent.
 */
export function readMapUiPreferencesFromStorage(
  localStorage: MapUiStorage,
  legacySessionStorage: MapUiStorage | null = null,
): MapUiPreferences {
  const stored = localStorage.getItem(MAP_UI_PREFERENCES_STORAGE_KEY);
  if (stored !== null) {
    return parseMapUiPreferences(stored);
  }

  const legacy = legacySessionStorage?.getItem(MAP_UI_PREFERENCES_STORAGE_KEY);
  const migrated = parseStoredMapUiPreferences(legacy);
  if (migrated !== null) {
    writeMapUiPreferencesToStorage(localStorage, migrated);
    return migrated;
  }
  return { ...DEFAULT_MAP_UI_PREFERENCES };
}

export function parseMapUiPreferences(raw: string | null): MapUiPreferences {
  return parseStoredMapUiPreferences(raw) ?? { ...DEFAULT_MAP_UI_PREFERENCES };
}

export function writeMapUiPreferences(preferences: MapUiPreferences): void {
  const storage = safeLocalStorage();
  if (storage === null) {
    return;
  }
  writeMapUiPreferencesToStorage(storage, preferences);
}

export function writeMapUiPreferencesToStorage(storage: MapUiStorage, preferences: MapUiPreferences): void {
  try {
    storage.setItem(
      MAP_UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: MAP_UI_PREFERENCES_VERSION, ...preferences }),
    );
  } catch {
    // Storage can be unavailable or quota-restricted; defaults remain usable.
  }
}

function safeLocalStorage(): MapUiStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function safeSessionStorage(): MapUiStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function parseStoredMapUiPreferences(raw: string | null | undefined): MapUiPreferences | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== MAP_UI_PREFERENCES_VERSION) {
      return null;
    }
    if (
      (value.pathOpacity !== 0 && value.pathOpacity !== 0.5 && value.pathOpacity !== 1) ||
      typeof value.protectEnabled !== 'boolean' ||
      typeof value.gridEnabled !== 'boolean'
    ) {
      return null;
    }
    return {
      pathOpacity: value.pathOpacity,
      protectEnabled: value.protectEnabled,
      gridEnabled: value.gridEnabled,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
