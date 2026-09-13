import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BiomeStroke, Id, MapObject, MapRecord } from '../../../shared/domain';
import { createMap, deleteMap, duplicateMap, listMaps, loadMapState, renameMap } from '../api/maps';
import { createBiomeStroke } from '../api/objects';
import { actorId, rememberedMapId, rememberMapId } from '../lib/browserIdentity';
import { createOptimisticBiomeStroke, type CompletedBrushGesture } from '../lib/biomeStroke';
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
  const actorIdRef = useRef<Id | null>(null);
  const loadRequestRef = useRef(0);
  const pendingSaveCountRef = useRef(0);
  const mapActionInFlightRef = useRef(false);

  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [currentMap, setCurrentMap] = useState<MapRecord | null>(null);
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [pendingStrokes, setPendingStrokes] = useState<BiomeStroke[]>([]);
  const [loadState, setLoadState] = useState<MapLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapActionBusy, setMapActionBusy] = useState(false);

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
      return { ok: false, error: 'Wait for the terrain save to finish before changing maps.' };
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

  const strokes = useMemo(
    () =>
      [...objects.filter(isBiomeStroke), ...pendingStrokes].sort(
        (left, right) => left.layer - right.layer || left.orderKey - right.orderKey,
      ),
    [objects, pendingStrokes],
  );

  return {
    camera,
    setCamera,
    maps,
    currentMap,
    strokes,
    pendingStrokeCount: pendingStrokes.length,
    loadState,
    loadError,
    saveError,
    mapError,
    mapActionBusy,
    mapActionsDisabled: mapActionBusy || pendingStrokes.length > 0 || loadState === 'loading',
    retryBootstrap: bootstrap,
    switchMap,
    createAndSelectMap,
    renameExistingMap,
    duplicateAndSelectMap,
    deleteExistingMap,
    saveStroke,
  };
}

function isBiomeStroke(object: MapObject): object is BiomeStroke {
  return object.objectType === 'biome_stroke';
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
