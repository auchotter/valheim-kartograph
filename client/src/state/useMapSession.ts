import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BiomeStroke, Id, MapObject, MapRecord, Path } from '../../../shared/domain';
import { createMap, deleteMap, duplicateMap, listMaps, loadMapState, renameMap } from '../api/maps';
import { ApiClientError } from '../api/http';
import { createBiomeStroke, createPath, deletePath, updatePath } from '../api/objects';
import { actorId, rememberedMapId, rememberMapId } from '../lib/browserIdentity';
import { createOptimisticBiomeStroke, type CompletedBrushGesture } from '../lib/biomeStroke';
import { createOptimisticPath } from '../lib/pathObject';
import type { CompletedPathGesture } from '../lib/pathGeometry';
import { DEFAULT_CAMERA, type Camera } from '../lib/camera';

export type MapLoadState = 'loading' | 'ready' | 'error';

export interface MapActionResult {
  ok: boolean;
  error?: string;
}

interface ActivateOptions {
  maps?: MapRecord[];
  resetCamera: boolean;
  preservePreviousMapOnFailure?: boolean;
}

const DEFAULT_MAP_NAME = 'Our World';

/** Owns the active map and its REST lifecycle; rendering remains in MapCanvas. */
export function useMapSession() {
  const currentMapRef = useRef<MapRecord | null>(null);
  const objectsRef = useRef<MapObject[]>([]);
  const actorIdRef = useRef<Id | null>(null);
  const loadRequestRef = useRef(0);
  const pendingSaveCountRef = useRef(0);
  const mapActionInFlightRef = useRef(false);

  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [currentMap, setCurrentMap] = useState<MapRecord | null>(null);
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [pendingStrokes, setPendingStrokes] = useState<BiomeStroke[]>([]);
  const [pendingPaths, setPendingPaths] = useState<Path[]>([]);
  const [pendingPathMutationCount, setPendingPathMutationCount] = useState(0);
  const [loadState, setLoadState] = useState<MapLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapActionBusy, setMapActionBusy] = useState(false);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  const applyLoadedMap = useCallback(
    (
      state: { map: MapRecord; objects: MapObject[] },
      mapList: MapRecord[] | undefined,
      resetCamera: boolean,
    ) => {
      currentMapRef.current = state.map;
      setCurrentMap(state.map);
      setObjects(state.objects);
      setPendingStrokes([]);
      setPendingPaths([]);
      setMaps((current) => replaceMap(mapList ?? current, state.map));
      setLoadError(null);
      setMapError(null);
      setLoadState('ready');
      rememberMapId(state.map.id);
      if (resetCamera) {
        setCamera({ ...DEFAULT_CAMERA });
      }
    },
    [],
  );

  const activateMap = useCallback(
    async (mapId: Id, options: ActivateOptions): Promise<MapActionResult> => {
      const request = ++loadRequestRef.current;
      const previousMap = currentMapRef.current;
      setLoadState('loading');
      setLoadError(null);
      setMapError(null);

      try {
        const state = await loadMapState(mapId);
        if (request !== loadRequestRef.current) {
          return { ok: false, error: 'Map selection was superseded by a newer request.' };
        }
        applyLoadedMap(state, options.maps, options.resetCamera);
        return { ok: true };
      } catch (error) {
        if (request !== loadRequestRef.current) {
          return { ok: false, error: 'Map selection was superseded by a newer request.' };
        }

        const message = toMessage(error, 'Unable to load the selected map.');
        if (options.preservePreviousMapOnFailure !== false && previousMap !== null) {
          // The existing state remains authoritative until another state fetch succeeds.
          setLoadState('ready');
          setMapError(message);
          return { ok: false, error: message };
        }

        setLoadState('error');
        setLoadError(message);
        return { ok: false, error: message };
      }
    },
    [applyLoadedMap],
  );

  const bootstrap = useCallback(async (): Promise<MapActionResult> => {
    const request = ++loadRequestRef.current;
    setLoadState('loading');
    setLoadError(null);
    setMapError(null);

    try {
      let mapList = await listMaps();
      if (request !== loadRequestRef.current) {
        return { ok: false };
      }
      if (mapList.length === 0) {
        try {
          await createMap(DEFAULT_MAP_NAME);
        } catch (error) {
          // StrictMode or another browser may have created the fallback first.
          mapList = await listMaps();
          if (mapList.length === 0) {
            throw error;
          }
        }
        if (mapList.length === 0) {
          mapList = await listMaps();
        }
      }
      if (request !== loadRequestRef.current) {
        return { ok: false };
      }

      setMaps(mapList);
      const remembered = rememberedMapId();
      const selected = mapList.find((map) => map.id === remembered) ?? mapList[0];
      const state = await loadMapState(selected.id);
      if (request !== loadRequestRef.current) {
        return { ok: false };
      }
      applyLoadedMap(state, mapList, false);
      return { ok: true };
    } catch (error) {
      if (request !== loadRequestRef.current) {
        return { ok: false };
      }
      const message = toMessage(error, 'Unable to load the current map.');
      setLoadState('error');
      setLoadError(message);
      return { ok: false, error: message };
    }
  }, [applyLoadedMap]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const runMapAction = useCallback(async (work: () => Promise<MapActionResult>): Promise<MapActionResult> => {
    if (pendingSaveCountRef.current > 0) {
      return { ok: false, error: 'Wait for the active map save to finish before changing maps.' };
    }
    if (mapActionInFlightRef.current) {
      return { ok: false, error: 'A map action is already in progress.' };
    }

    mapActionInFlightRef.current = true;
    setMapActionBusy(true);
    setMapError(null);
    try {
      return await work();
    } catch (error) {
      const message = toMessage(error, 'Map action failed.');
      setMapError(message);
      return { ok: false, error: message };
    } finally {
      mapActionInFlightRef.current = false;
      setMapActionBusy(false);
    }
  }, []);

  const switchMap = useCallback(
    (mapId: Id): Promise<MapActionResult> =>
      runMapAction(async () => {
        if (currentMapRef.current?.id === mapId) {
          return { ok: true };
        }
        return activateMap(mapId, { resetCamera: true, preservePreviousMapOnFailure: true });
      }),
    [activateMap, runMapAction],
  );

  const createAndSelectMap = useCallback(
    (rawName: string): Promise<MapActionResult> =>
      runMapAction(async () => {
        const name = normaliseName(rawName);
        if (name === null) {
          return { ok: false, error: 'Enter a map name.' };
        }
        const created = await createMap(name);
        const mapList = await listMaps();
        setMaps(mapList);
        return activateMap(created.id, { maps: mapList, resetCamera: true, preservePreviousMapOnFailure: true });
      }),
    [activateMap, runMapAction],
  );

  const renameExistingMap = useCallback(
    (mapId: Id, rawName: string): Promise<MapActionResult> =>
      runMapAction(async () => {
        const name = normaliseName(rawName);
        if (name === null) {
          return { ok: false, error: 'Enter a map name.' };
        }
        const renamed = await renameMap(mapId, name);
        setMaps((current) => replaceMap(current, renamed));
        if (currentMapRef.current?.id === mapId) {
          currentMapRef.current = renamed;
          setCurrentMap(renamed);
        }
        return { ok: true };
      }),
    [runMapAction],
  );

  const duplicateAndSelectMap = useCallback(
    (mapId: Id, rawName: string): Promise<MapActionResult> =>
      runMapAction(async () => {
        const name = normaliseName(rawName);
        if (name === null) {
          return { ok: false, error: 'Enter a map name.' };
        }
        const duplicate = await duplicateMap(mapId, name);
        const mapList = await listMaps();
        setMaps(mapList);
        return activateMap(duplicate.id, { maps: mapList, resetCamera: true, preservePreviousMapOnFailure: true });
      }),
    [activateMap, runMapAction],
  );

  const deleteExistingMap = useCallback(
    (mapId: Id): Promise<MapActionResult> =>
      runMapAction(async () => {
        const wasCurrent = currentMapRef.current?.id === mapId;
        await deleteMap(mapId);
        let mapList = await listMaps();

        if (!wasCurrent) {
          setMaps(mapList);
          return { ok: true };
        }

        if (mapList.length === 0) {
          try {
            await createMap(DEFAULT_MAP_NAME);
          } catch (error) {
            mapList = await listMaps();
            if (mapList.length === 0) {
              throw error;
            }
          }
          if (mapList.length === 0) {
            mapList = await listMaps();
          }
        }

        setMaps(mapList);
        currentMapRef.current = null;
        setCurrentMap(null);
        setObjects([]);
        setPendingStrokes([]);
        setPendingPaths([]);
        return activateMap(mapList[0].id, {
          maps: mapList,
          resetCamera: true,
          preservePreviousMapOnFailure: false,
        });
      }),
    [activateMap, runMapAction],
  );

  const saveStroke = useCallback(async (gesture: CompletedBrushGesture): Promise<void> => {
    const map = currentMapRef.current;
    if (map === null || mapActionInFlightRef.current) {
      return;
    }

    const id = crypto.randomUUID();
    const optimistic = createOptimisticBiomeStroke({ ...gesture, mapId: map.id, id });
    const clientOperationId = crypto.randomUUID();
    const mapId = map.id;
    pendingSaveCountRef.current += 1;
    setPendingStrokes((current) => [...current, optimistic]);
    setSaveError(null);

    try {
      const result = await createBiomeStroke(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        {
          id,
          objectType: 'biome_stroke',
          mode: gesture.mode,
          biome: gesture.biome,
          brushWidth: gesture.brushWidth,
          points: gesture.points,
        },
      );

      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      setPendingStrokes((current) => current.filter((stroke) => stroke.id !== id));
      setObjects((current) => [...current.filter((object) => object.id !== result.object.id), result.object]);
      setCurrentMap((current) => {
        if (current === null || current.id !== mapId || result.mapRevision < current.revision) {
          return current;
        }
        const next = {
          ...current,
          revision: result.mapRevision,
          nextOrderKey: Math.max(current.nextOrderKey, result.object.orderKey + 1),
          updatedAt: result.object.updatedAt,
        };
        currentMapRef.current = next;
        return next;
      });
    } catch (error) {
      if (currentMapRef.current?.id === mapId) {
        setPendingStrokes((current) => current.filter((stroke) => stroke.id !== id));
        setSaveError(toMessage(error, 'Save failed.'));
      }
    } finally {
      pendingSaveCountRef.current -= 1;
    }
  }, []);

  const savePath = useCallback(async (gesture: CompletedPathGesture): Promise<void> => {
    const map = currentMapRef.current;
    if (map === null || mapActionInFlightRef.current) {
      return;
    }

    const mapId = map.id;
    const optimistic = createOptimisticPath({
      id: gesture.id,
      mapId,
      geometryType: gesture.geometryType,
      strokeWidth: gesture.strokeWidth,
      points: gesture.points,
    });
    const clientOperationId = crypto.randomUUID();
    pendingSaveCountRef.current += 1;
    setPendingPathMutationCount((count) => count + 1);
    setPendingPaths((current) => [...current, optimistic]);
    setSaveError(null);

    try {
      const result = await createPath(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        {
          id: gesture.id,
          objectType: 'path',
          pathType: 'path',
          geometryType: gesture.geometryType,
          strokeWidth: gesture.strokeWidth,
          points: gesture.points,
        },
      );

      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      setPendingPaths((current) => current.filter((path) => path.id !== gesture.id));
      setObjects((current) => replaceObject(current, result.object));
      updateCurrentMapRevision(mapId, result.mapRevision, result.object.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap);
    } catch (error) {
      if (currentMapRef.current?.id === mapId) {
        setPendingPaths((current) => current.filter((path) => path.id !== gesture.id));
        setSaveError(toMessage(error, 'Path save failed.'));
      }
    } finally {
      pendingSaveCountRef.current -= 1;
      setPendingPathMutationCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const savePathUpdate = useCallback(async (draft: Path): Promise<void> => {
    const map = currentMapRef.current;
    const previous = objectsRef.current.find(
      (object): object is Path => object.id === draft.id && object.objectType === 'path',
    );
    if (
      map === null ||
      mapActionInFlightRef.current ||
      previous === undefined ||
      previous.mapId !== map.id ||
      previous.objectVersion < 1
    ) {
      return;
    }

    const mapId = map.id;
    const clientOperationId = crypto.randomUUID();
    pendingSaveCountRef.current += 1;
    setPendingPathMutationCount((count) => count + 1);
    setObjects((current) => replaceObject(current, draft));
    setSaveError(null);

    try {
      const result = await updatePath(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        previous.objectVersion,
        draft,
      );
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      setObjects((current) => replaceObject(current, result.object));
      updateCurrentMapRevision(mapId, result.mapRevision, result.object.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap);
    } catch (error) {
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      if (error instanceof ApiClientError && error.status === 409) {
        await refreshObjectsAfterConflict(mapId, currentMapRef, setCurrentMap, setObjects, setSaveError);
      } else {
        setObjects((current) => replaceObject(current, previous));
        setSaveError(toMessage(error, 'Path update failed.'));
      }
    } finally {
      pendingSaveCountRef.current -= 1;
      setPendingPathMutationCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const removePath = useCallback(async (pathId: Id): Promise<void> => {
    const map = currentMapRef.current;
    const previous = objectsRef.current.find(
      (object): object is Path => object.id === pathId && object.objectType === 'path',
    );
    if (map === null || mapActionInFlightRef.current || previous === undefined || previous.mapId !== map.id) {
      return;
    }

    const mapId = map.id;
    const clientOperationId = crypto.randomUUID();
    pendingSaveCountRef.current += 1;
    setPendingPathMutationCount((count) => count + 1);
    setObjects((current) => current.filter((object) => object.id !== pathId));
    setSaveError(null);

    try {
      const result = await deletePath(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        pathId,
        previous.objectVersion,
      );
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      updateCurrentMapRevision(mapId, result.mapRevision, previous.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap);
    } catch (error) {
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      if (error instanceof ApiClientError && error.status === 409) {
        await refreshObjectsAfterConflict(mapId, currentMapRef, setCurrentMap, setObjects, setSaveError);
      } else {
        setObjects((current) => replaceObject(current, previous));
        setSaveError(toMessage(error, 'Path deletion failed.'));
      }
    } finally {
      pendingSaveCountRef.current -= 1;
      setPendingPathMutationCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const strokes = useMemo(
    () =>
      [...objects.filter(isBiomeStroke), ...pendingStrokes].sort(
        (left, right) => left.layer - right.layer || left.orderKey - right.orderKey,
      ),
    [objects, pendingStrokes],
  );

  const paths = useMemo(
    () =>
      [...objects.filter(isPath), ...pendingPaths].sort(
        (left, right) => left.layer - right.layer || left.orderKey - right.orderKey,
      ),
    [objects, pendingPaths],
  );

  return {
    camera,
    setCamera,
    maps,
    currentMap,
    strokes,
    paths,
    pendingStrokeCount: pendingStrokes.length,
    pendingPathMutationCount,
    loadState,
    loadError,
    saveError,
    mapError,
    mapActionBusy,
    mapActionsDisabled:
      mapActionBusy || pendingStrokes.length > 0 || pendingPathMutationCount > 0 || loadState === 'loading',
    retryBootstrap: bootstrap,
    switchMap,
    createAndSelectMap,
    renameExistingMap,
    duplicateAndSelectMap,
    deleteExistingMap,
    saveStroke,
    savePath,
    savePathUpdate,
    removePath,
  };
}

function isBiomeStroke(object: MapObject): object is BiomeStroke {
  return object.objectType === 'biome_stroke';
}

function isPath(object: MapObject): object is Path {
  return object.objectType === 'path';
}

function replaceObject(objects: readonly MapObject[], replacement: MapObject): MapObject[] {
  const index = objects.findIndex((object) => object.id === replacement.id);
  return index === -1
    ? [...objects, replacement]
    : objects.map((object) => (object.id === replacement.id ? replacement : object));
}

function updateCurrentMapRevision(
  mapId: Id,
  mapRevision: number,
  objectOrderKey: number,
  updatedAt: string,
  currentMapRef: { current: MapRecord | null },
  setCurrentMap: Dispatch<SetStateAction<MapRecord | null>>,
): void {
  setCurrentMap((current) => {
    if (current === null || current.id !== mapId || mapRevision < current.revision) {
      return current;
    }
    const next = {
      ...current,
      revision: mapRevision,
      nextOrderKey: Math.max(current.nextOrderKey, objectOrderKey + 1),
      updatedAt,
    };
    currentMapRef.current = next;
    return next;
  });
}

async function refreshObjectsAfterConflict(
  mapId: Id,
  currentMapRef: { current: MapRecord | null },
  setCurrentMap: Dispatch<SetStateAction<MapRecord | null>>,
  setObjects: Dispatch<SetStateAction<MapObject[]>>,
  setSaveError: Dispatch<SetStateAction<string | null>>,
): Promise<void> {
  try {
    const state = await loadMapState(mapId);
    if (currentMapRef.current?.id !== mapId) {
      return;
    }
    currentMapRef.current = state.map;
    setCurrentMap(state.map);
    setObjects(state.objects);
    setSaveError('Path changed elsewhere; the current map state was reloaded.');
  } catch (error) {
    if (currentMapRef.current?.id === mapId) {
      setSaveError(toMessage(error, 'Path conflict detected; unable to reload the current map.'));
    }
  }
}

function replaceMap(maps: readonly MapRecord[], map: MapRecord): MapRecord[] {
  const existingIndex = maps.findIndex((candidate) => candidate.id === map.id);
  if (existingIndex === -1) {
    return [...maps, map];
  }
  return maps.map((candidate) => (candidate.id === map.id ? map : candidate));
}

function normaliseName(value: string): string | null {
  const name = value.trim();
  return name.length > 0 ? name : null;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
