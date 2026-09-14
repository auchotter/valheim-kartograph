import { clampZoom, type Camera } from './camera';

export const CAMERA_VIEW_STORAGE_KEY = 'valheim-map:view:v1';
export const CAMERA_VIEW_VERSION = 1;
export const CAMERA_VIEW_WRITE_DEBOUNCE_MS = 300;

export interface CameraViewRecord {
  version: typeof CAMERA_VIEW_VERSION;
  mapId: string;
  cameraX: number;
  cameraY: number;
  zoom: number;
}

export interface CameraViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function cameraViewRecord(mapId: string, camera: Camera): CameraViewRecord {
  return {
    version: CAMERA_VIEW_VERSION,
    mapId,
    cameraX: camera.cameraX,
    cameraY: camera.cameraY,
    zoom: camera.zoom,
  };
}

/** Parses untrusted storage and only accepts a record for the active map. */
export function parseCameraViewRecord(raw: string | null, activeMapId: string): CameraViewRecord | null {
  if (raw === null) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== CAMERA_VIEW_VERSION || value.mapId !== activeMapId) {
      return null;
    }
    if (
      typeof value.cameraX !== 'number' ||
      !Number.isFinite(value.cameraX) ||
      typeof value.cameraY !== 'number' ||
      !Number.isFinite(value.cameraY) ||
      typeof value.zoom !== 'number' ||
      !Number.isFinite(value.zoom)
    ) {
      return null;
    }

    return {
      version: CAMERA_VIEW_VERSION,
      mapId: activeMapId,
      cameraX: value.cameraX,
      cameraY: value.cameraY,
      zoom: clampZoom(value.zoom),
    };
  } catch {
    return null;
  }
}

export function readCameraViewForMap(mapId: string): CameraViewRecord | null {
  const storage = safeLocalStorage();
  if (storage === null) {
    return null;
  }

  try {
    return readCameraViewFromStorage(storage, mapId, safeSessionStorage());
  } catch {
    return null;
  }
}

/** Reads durable camera state and migrates one valid record from the old tab store. */
export function readCameraViewFromStorage(
  localStorage: CameraViewStorage,
  mapId: string,
  legacySessionStorage: CameraViewStorage | null = null,
): CameraViewRecord | null {
  const stored = localStorage.getItem(CAMERA_VIEW_STORAGE_KEY);
  if (stored !== null) {
    return parseCameraViewRecord(stored, mapId);
  }

  const legacy = legacySessionStorage?.getItem(CAMERA_VIEW_STORAGE_KEY);
  const migrated = parseCameraViewRecord(legacy ?? null, mapId);
  if (migrated !== null) {
    writeCameraViewToStorage(localStorage, migrated);
  }
  return migrated;
}

export function writeCameraView(record: CameraViewRecord): void {
  const storage = safeLocalStorage();
  if (storage === null) {
    return;
  }
  writeCameraViewToStorage(storage, record);
}

export function writeCameraViewToStorage(storage: CameraViewStorage, record: CameraViewRecord): void {
  try {
    storage.setItem(CAMERA_VIEW_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Private browsing and restrictive storage policies can reject writes.
  }
}

function safeLocalStorage(): CameraViewStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function safeSessionStorage(): CameraViewStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
