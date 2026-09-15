import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BiomeStroke, Id, Label, MapObject, MapRecord, Marker, Path } from '../../../shared/domain';
import { createMap, deleteMap, duplicateMap, listMaps, loadMapState, redoMap as requestRedo, renameMap, undoMap as requestUndo } from '../api/maps';
import { ApiClientError } from '../api/http';
import {
  createBiomeStroke,
  createLabel,
  createMarker,
  createPath,
  deleteLabel,
  deleteMarker,
  deletePath,
  updateLabel,
  updateMarker,
  updatePath,
} from '../api/objects';
import { actorId, rememberedMapId, rememberMapId } from '../lib/browserIdentity';
import { createOptimisticBiomeStroke, type CompletedBrushGesture } from '../lib/biomeStroke';
import { createOptimisticPath } from '../lib/pathObject';
import { createOptimisticMarker, type CompletedMarkerGesture } from '../lib/markerObject';
import { createOptimisticLabel, type CompletedLabelGesture } from '../lib/labelObject';
import type { CompletedPathGesture } from '../lib/pathGeometry';
import { DEFAULT_CAMERA, type Camera } from '../lib/camera';
import {
  cameraViewRecord,
  CAMERA_VIEW_WRITE_DEBOUNCE_MS,
  readCameraViewForMap,
  writeCameraView,
  type CameraViewRecord,
} from '../lib/cameraViewPersistence';
import {
  applyAcceptedObjectEvent,
  classifyRealtimeRevision,
  mapWebSocketUrl,
  parseRealtimeMessage,
} from '../lib/realtime';
import type { MapObjectAcceptedMessage } from '../../../shared/realtime';
import { ScopedMutationGuard } from '../lib/mutationGuards';
import { isMissingMapRecoveryError } from '../lib/realtimeRecovery';

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
  const localRevisionRef = useRef(0);
  const objectsRef = useRef<MapObject[]>([]);
  const actorIdRef = useRef<Id | null>(null);
  const loadRequestRef = useRef(0);
  const pendingSaveCountRef = useRef(0);
  const pendingOperationIdsRef = useRef(new Map<Id, { mapId: Id; objectId: Id }>());
  const pendingDrainWaitersRef = useRef(new Set<() => void>());
  const pathMutationGuardRef = useRef(new ScopedMutationGuard());
  const markerMutationGuardRef = useRef(new ScopedMutationGuard());
  const labelMutationGuardRef = useRef(new ScopedMutationGuard());
  const mapActionInFlightRef = useRef(false);
  const historyInFlightRef = useRef(false);
  const currentSocketRef = useRef<WebSocket | null>(null);
  const socketGenerationRef = useRef(0);

  const [camera, setCameraState] = useState<Camera>(DEFAULT_CAMERA);
  const latestCameraViewRef = useRef<CameraViewRecord | null>(null);
  const cameraWriteTimerRef = useRef<number | null>(null);
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [currentMap, setCurrentMap] = useState<MapRecord | null>(null);
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [pendingStrokes, setPendingStrokes] = useState<BiomeStroke[]>([]);
  const [pendingPaths, setPendingPaths] = useState<Path[]>([]);
  const [pendingMarkers, setPendingMarkers] = useState<Marker[]>([]);
  const [pendingLabels, setPendingLabels] = useState<Label[]>([]);
  const [pendingPathMutationCount, setPendingPathMutationCount] = useState(0);
  const [pendingMarkerMutationCount, setPendingMarkerMutationCount] = useState(0);
  const [pendingLabelMutationCount, setPendingLabelMutationCount] = useState(0);
  const [pendingPathIds, setPendingPathIds] = useState<Set<Id>>(() => new Set());
  const [pendingMarkerIds, setPendingMarkerIds] = useState<Set<Id>>(() => new Set());
  const [pendingLabelIds, setPendingLabelIds] = useState<Set<Id>>(() => new Set());
  const [loadState, setLoadState] = useState<MapLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [redoPending, setRedoPending] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapActionBusy, setMapActionBusy] = useState(false);
  const [collaborationStatus, setCollaborationStatus] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'recovering' | 'disconnected'
  >('disconnected');

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  const flushCameraView = useCallback((): void => {
    if (cameraWriteTimerRef.current !== null) {
      window.clearTimeout(cameraWriteTimerRef.current);
      cameraWriteTimerRef.current = null;
    }
    if (latestCameraViewRef.current !== null) {
      writeCameraView(latestCameraViewRef.current);
    }
  }, []);

  const cancelPendingCameraWrite = useCallback((): void => {
    if (cameraWriteTimerRef.current !== null) {
      window.clearTimeout(cameraWriteTimerRef.current);
      cameraWriteTimerRef.current = null;
    }
  }, []);

  const scheduleCameraViewWrite = useCallback((mapId: Id, nextCamera: Camera): void => {
    latestCameraViewRef.current = cameraViewRecord(mapId, nextCamera);
    cancelPendingCameraWrite();
    cameraWriteTimerRef.current = window.setTimeout(() => {
      cameraWriteTimerRef.current = null;
      if (latestCameraViewRef.current !== null) {
        writeCameraView(latestCameraViewRef.current);
      }
    }, CAMERA_VIEW_WRITE_DEBOUNCE_MS);
  }, [cancelPendingCameraWrite]);

  const setCamera = useCallback((nextCamera: Camera): void => {
    setCameraState(nextCamera);
    const map = currentMapRef.current;
    if (map !== null) {
      scheduleCameraViewWrite(map.id, nextCamera);
    }
  }, [scheduleCameraViewWrite]);

  useEffect(() => {
    const onPageHide = () => flushCameraView();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      flushCameraView();
    };
  }, [flushCameraView]);

  const waitForPendingMutations = useCallback((): Promise<void> => {
    if (pendingSaveCountRef.current === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      pendingDrainWaitersRef.current.add(resolve);
    });
  }, []);

  const finishPendingMutation = useCallback((): void => {
    pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
    if (pendingSaveCountRef.current !== 0) {
      return;
    }
    const waiters = [...pendingDrainWaitersRef.current];
    pendingDrainWaitersRef.current.clear();
    for (const resolve of waiters) {
      resolve();
    }
  }, []);

  const trackPendingOperation = useCallback((clientOperationId: Id, mapId: Id, objectId: Id): void => {
    pendingOperationIdsRef.current.set(clientOperationId, { mapId, objectId });
  }, []);

  const applyLoadedMap = useCallback(
    (
      state: { map: MapRecord; objects: MapObject[] },
      mapList: MapRecord[] | undefined,
      resetCamera: boolean,
      cameraOverride?: Camera,
    ) => {
      currentMapRef.current = state.map;
      localRevisionRef.current = state.map.revision;
      objectsRef.current = state.objects;
      setCurrentMap(state.map);
      setObjects(state.objects);
      setPendingStrokes([]);
      setPendingPaths([]);
      setPendingMarkers([]);
      setPendingLabels([]);
      pathMutationGuardRef.current.clear();
      markerMutationGuardRef.current.clear();
      labelMutationGuardRef.current.clear();
      setPendingPathIds(new Set());
      setPendingMarkerIds(new Set());
      setPendingLabelIds(new Set());
      setMaps((current) => replaceMap(mapList ?? current, state.map));
      setLoadError(null);
      setMapError(null);
      setUndoMessage(null);
      setLoadState('ready');
      rememberMapId(state.map.id);
      const nextCamera = cameraOverride ?? (resetCamera ? { ...DEFAULT_CAMERA } : undefined);
      if (nextCamera !== undefined) {
        cancelPendingCameraWrite();
        setCameraState(nextCamera);
        scheduleCameraViewWrite(state.map.id, nextCamera);
      }
    },
    [cancelPendingCameraWrite, scheduleCameraViewWrite],
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
      const savedView = readCameraViewForMap(state.map.id);
      const initialCamera: Camera = savedView === null
        ? { ...DEFAULT_CAMERA }
        : { cameraX: savedView.cameraX, cameraY: savedView.cameraY, zoom: savedView.zoom };
      applyLoadedMap(state, mapList, false, initialCamera);
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

  useEffect(() => {
    if (loadState !== 'ready' || currentMap === null) {
      currentSocketRef.current?.close(1000, 'Map session is not ready');
      currentSocketRef.current = null;
      setCollaborationStatus('disconnected');
      return undefined;
    }

    const mapId = currentMap.id;
    const generation = ++socketGenerationRef.current;
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let recovering = false;

    const isCurrent = (): boolean =>
      !disposed && socketGenerationRef.current === generation && currentMapRef.current?.id === mapId;

    const closeSocket = (reason: string): void => {
      const current = socket;
      socket = null;
      if (currentSocketRef.current === current) {
        currentSocketRef.current = null;
      }
      current?.close(1000, reason);
    };

    const fallBackFromUnavailableMap = (): void => {
      if (!isCurrent()) {
        return;
      }
      // Invalidate this socket session before bootstrapping another map. This
      // prevents a late close/recovery callback for the deleted map from
      // starting another reconnect cycle.
      recovering = true;
      ++socketGenerationRef.current;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      closeSocket('Map is unavailable');
      void bootstrap();
    };

    const reconcileOwnEcho = (event: MapObjectAcceptedMessage): void => {
      const pending = pendingOperationIdsRef.current.get(event.clientOperationId);
      if (pending === undefined || pending.mapId !== mapId) {
        return;
      }
      setPendingStrokes((current) => current.filter((stroke) => stroke.id !== pending.objectId));
      setPendingPaths((current) => current.filter((path) => path.id !== pending.objectId));
      setPendingMarkers((current) => current.filter((marker) => marker.id !== pending.objectId));
    };

    const applyAccepted = (event: MapObjectAcceptedMessage): void => {
      if (!isCurrent() || event.mapId !== mapId) {
        return;
      }

      const localRevision = localRevisionRef.current;
      const revisionDecision = classifyRealtimeRevision(localRevision, event.revision);
      if (revisionDecision === 'old') {
        reconcileOwnEcho(event);
        return;
      }

      if (revisionDecision === 'duplicate') {
        if (pendingOperationIdsRef.current.has(event.clientOperationId)) {
          const reconciled = applyAcceptedObjectEvent(objectsRef.current, event);
          if (reconciled !== null) {
            objectsRef.current = reconciled;
            setObjects(reconciled);
          }
          reconcileOwnEcho(event);
        }
        return;
      }

      if (revisionDecision === 'gap') {
        void recoverAndReconnect();
        return;
      }

      const nextObjects = applyAcceptedObjectEvent(objectsRef.current, event);
      if (nextObjects === null) {
        void recoverAndReconnect();
        return;
      }
      objectsRef.current = nextObjects;
      localRevisionRef.current = event.revision;
      setObjects(nextObjects);
      reconcileOwnEcho(event);
      const acceptedObject = event.payload.after ?? event.payload.before;
      updateCurrentMapRevision(
        mapId,
        event.revision,
        acceptedObject?.orderKey ?? 0,
        event.createdAt,
        currentMapRef,
        setCurrentMap,
        localRevisionRef,
      );
    };

    const scheduleRecovery = (): void => {
      if (!isCurrent() || recovering || reconnectTimer !== null) {
        return;
      }
      setCollaborationStatus('reconnecting');
      const delay = Math.min(5_000, 250 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void recoverAndReconnect();
      }, delay);
    };

    const connect = (): void => {
      if (!isCurrent()) {
        return;
      }
      setCollaborationStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
      const candidate = new WebSocket(mapWebSocketUrl(mapId));
      socket = candidate;
      currentSocketRef.current = candidate;

      candidate.onmessage = (message) => {
        if (!isCurrent() || socket !== candidate) {
          return;
        }
        const parsed = parseRealtimeMessage(message.data);
        if (parsed === null || parsed.mapId !== mapId) {
          return;
        }
        if (parsed.type === 'map.ready') {
          const localRevision = currentMapRef.current?.revision ?? 0;
          if (parsed.revision === localRevision) {
            reconnectAttempt = 0;
            setCollaborationStatus('connected');
          } else {
            void recoverAndReconnect();
          }
          return;
        }
        if (parsed.type === 'map.unavailable') {
          fallBackFromUnavailableMap();
          return;
        }
        if (!recovering) {
          applyAccepted(parsed);
        }
      };

      candidate.onerror = () => {
        candidate.close();
      };
      candidate.onclose = () => {
        if (socket === candidate) {
          socket = null;
        }
        if (currentSocketRef.current === candidate) {
          currentSocketRef.current = null;
        }
        if (isCurrent() && !recovering) {
          scheduleRecovery();
        }
      };
    };

    const recoverAndReconnect = async (): Promise<void> => {
      if (!isCurrent() || recovering) {
        return;
      }
      recovering = true;
      setCollaborationStatus('recovering');
      closeSocket('Recovering map state');
      await waitForPendingMutations();
      if (!isCurrent()) {
        return;
      }
      try {
        const state = await loadMapState(mapId);
        if (!isCurrent()) {
          return;
        }
        applyLoadedMap(state, undefined, false);
        reconnectAttempt = 0;
        recovering = false;
        connect();
      } catch (error) {
        if (isMissingMapRecoveryError(error)) {
          // The map may have been deleted between REST hydration and socket
          // subscription, so there is no socket event to receive. Reuse the
          // normal bootstrap/fallback flow and stop reconnecting this session.
          fallBackFromUnavailableMap();
          return;
        }
        recovering = false;
        if (isCurrent()) {
          setMapError(toMessage(error, 'Unable to recover the live map state.'));
          scheduleRecovery();
        }
      }
    };

    connect();
    return () => {
      disposed = true;
      ++socketGenerationRef.current;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      reconnectTimer = null;
      recovering = false;
      closeSocket('Map session changed');
      if (currentSocketRef.current === socket) {
        currentSocketRef.current = null;
      }
      setCollaborationStatus('disconnected');
    };
  }, [applyLoadedMap, bootstrap, currentMap?.id, loadState, waitForPendingMutations]);

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

  const beginPathMutation = useCallback((mapId: Id, pathId: Id): boolean => {
    if (!pathMutationGuardRef.current.tryAcquire(mapId, pathId)) {
      return false;
    }
    if (currentMapRef.current?.id === mapId) {
      setPendingPathIds((current) => new Set(current).add(pathId));
    }
    return true;
  }, []);

  const finishPathMutation = useCallback((mapId: Id, pathId: Id): void => {
    pathMutationGuardRef.current.release(mapId, pathId);
    if (currentMapRef.current?.id === mapId) {
      setPendingPathIds((current) => {
        const next = new Set(current);
        next.delete(pathId);
        return next;
      });
    }
  }, []);

  const beginMarkerMutation = useCallback((mapId: Id, markerId: Id): boolean => {
    if (!markerMutationGuardRef.current.tryAcquire(mapId, markerId)) {
      return false;
    }
    if (currentMapRef.current?.id === mapId) {
      setPendingMarkerIds((current) => new Set(current).add(markerId));
    }
    return true;
  }, []);

  const finishMarkerMutation = useCallback((mapId: Id, markerId: Id): void => {
    markerMutationGuardRef.current.release(mapId, markerId);
    if (currentMapRef.current?.id === mapId) {
      setPendingMarkerIds((current) => {
        const next = new Set(current);
        next.delete(markerId);
        return next;
      });
    }
  }, []);

  const beginLabelMutation = useCallback((mapId: Id, labelId: Id): boolean => {
    if (!labelMutationGuardRef.current.tryAcquire(mapId, labelId)) {
      return false;
    }
    if (currentMapRef.current?.id === mapId) {
      setPendingLabelIds((current) => new Set(current).add(labelId));
    }
    return true;
  }, []);

  const finishLabelMutation = useCallback((mapId: Id, labelId: Id): void => {
    labelMutationGuardRef.current.release(mapId, labelId);
    if (currentMapRef.current?.id === mapId) {
      setPendingLabelIds((current) => {
        const next = new Set(current);
        next.delete(labelId);
        return next;
      });
    }
  }, []);

  const switchMap = useCallback(
    (mapId: Id): Promise<MapActionResult> =>
      runMapAction(async () => {
        if (currentMapRef.current?.id === mapId) {
          return { ok: true };
        }
        // Do not let the previous map's debounce fire while the replacement
        // map is still loading.
        cancelPendingCameraWrite();
        return activateMap(mapId, { resetCamera: true, preservePreviousMapOnFailure: true });
      }),
    [activateMap, cancelPendingCameraWrite, runMapAction],
  );

  const createAndSelectMap = useCallback(
    (rawName: string): Promise<MapActionResult> =>
      runMapAction(async () => {
        const name = normaliseName(rawName);
        if (name === null) {
          return { ok: false, error: 'Enter a map name.' };
        }
        cancelPendingCameraWrite();
        const created = await createMap(name);
        const mapList = await listMaps();
        setMaps(mapList);
        return activateMap(created.id, { maps: mapList, resetCamera: true, preservePreviousMapOnFailure: true });
      }),
    [activateMap, cancelPendingCameraWrite, runMapAction],
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
        cancelPendingCameraWrite();
        const duplicate = await duplicateMap(mapId, name);
        const mapList = await listMaps();
        setMaps(mapList);
        return activateMap(duplicate.id, { maps: mapList, resetCamera: true, preservePreviousMapOnFailure: true });
      }),
    [activateMap, cancelPendingCameraWrite, runMapAction],
  );

  const deleteExistingMap = useCallback(
    (mapId: Id): Promise<MapActionResult> =>
      runMapAction(async () => {
        const wasCurrent = currentMapRef.current?.id === mapId;
        if (wasCurrent) {
          cancelPendingCameraWrite();
        }
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
        localRevisionRef.current = 0;
        setCurrentMap(null);
        setObjects([]);
        setPendingStrokes([]);
        setPendingPaths([]);
        setPendingMarkers([]);
        setPendingLabels([]);
        return activateMap(mapList[0].id, {
          maps: mapList,
          resetCamera: true,
          preservePreviousMapOnFailure: false,
        });
      }),
    [activateMap, cancelPendingCameraWrite, runMapAction],
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
    trackPendingOperation(clientOperationId, mapId, id);
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
      if (currentMapRef.current?.revision !== undefined && currentMapRef.current.revision <= result.mapRevision) {
        localRevisionRef.current = result.mapRevision;
      }
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
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
    }
  }, []);

  const savePath = useCallback(async (gesture: CompletedPathGesture): Promise<void> => {
    const map = currentMapRef.current;
    if (map === null || mapActionInFlightRef.current) {
      return;
    }

    const mapId = map.id;
    if (!beginPathMutation(mapId, gesture.id)) {
      return;
    }
    const optimistic = createOptimisticPath({
      id: gesture.id,
      mapId,
      geometryType: gesture.geometryType,
      strokeWidth: gesture.strokeWidth,
      points: gesture.points,
    });
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, gesture.id);
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
      updateCurrentMapRevision(mapId, result.mapRevision, result.object.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
    } catch (error) {
      if (currentMapRef.current?.id === mapId) {
        setPendingPaths((current) => current.filter((path) => path.id !== gesture.id));
        setSaveError(toMessage(error, 'Path save failed.'));
      }
    } finally {
      finishPathMutation(mapId, gesture.id);
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingPathMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginPathMutation, finishPathMutation]);

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
      previous.objectVersion < 1 ||
      !beginPathMutation(map.id, draft.id)
    ) {
      return;
    }

    const mapId = map.id;
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, draft.id);
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
      updateCurrentMapRevision(mapId, result.mapRevision, result.object.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
    } catch (error) {
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      if (error instanceof ApiClientError && error.status === 409) {
        await refreshObjectsAfterConflict(mapId, currentMapRef, setCurrentMap, setObjects, setSaveError, localRevisionRef);
      } else {
        setObjects((current) => replaceObject(current, previous));
        setSaveError(toMessage(error, 'Path update failed.'));
      }
    } finally {
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingPathMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginPathMutation, finishPathMutation]);

  const removePath = useCallback(async (pathId: Id): Promise<void> => {
    const map = currentMapRef.current;
    const previous = objectsRef.current.find(
      (object): object is Path => object.id === pathId && object.objectType === 'path',
    );
    if (map === null || mapActionInFlightRef.current || previous === undefined || previous.mapId !== map.id) {
      return;
    }

    const mapId = map.id;
    if (!beginPathMutation(mapId, pathId)) {
      return;
    }
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, pathId);
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
      updateCurrentMapRevision(mapId, result.mapRevision, previous.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
    } catch (error) {
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      if (error instanceof ApiClientError && error.status === 409) {
        await refreshObjectsAfterConflict(mapId, currentMapRef, setCurrentMap, setObjects, setSaveError, localRevisionRef);
      } else {
        setObjects((current) => replaceObject(current, previous));
        setSaveError(toMessage(error, 'Path deletion failed.'));
      }
    } finally {
      finishPathMutation(mapId, pathId);
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingPathMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginPathMutation, finishPathMutation]);

  const saveMarker = useCallback(async (gesture: CompletedMarkerGesture): Promise<void> => {
    const map = currentMapRef.current;
    if (map === null || mapActionInFlightRef.current) {
      return;
    }

    const mapId = map.id;
    if (!beginMarkerMutation(mapId, gesture.id)) {
      return;
    }
    const optimistic = createOptimisticMarker({ ...gesture, mapId });
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, gesture.id);
    pendingSaveCountRef.current += 1;
    setPendingMarkerMutationCount((count) => count + 1);
    setPendingMarkers((current) => [...current, optimistic]);
    setSaveError(null);

    try {
      const result = await createMarker(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        {
          id: gesture.id,
          objectType: 'marker',
          markerType: gesture.markerType,
          x: gesture.x,
          y: gesture.y,
          name: null,
          note: null,
          sizeScale: 1,
          directionDegrees: gesture.directionDegrees,
        },
      );
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      setPendingMarkers((current) => current.filter((marker) => marker.id !== gesture.id));
      setObjects((current) => replaceObject(current, result.object));
      updateCurrentMapRevision(mapId, result.mapRevision, result.object.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
    } catch (error) {
      if (currentMapRef.current?.id === mapId) {
        setPendingMarkers((current) => current.filter((marker) => marker.id !== gesture.id));
        setSaveError(toMessage(error, 'Marker save failed.'));
      }
    } finally {
      finishMarkerMutation(mapId, gesture.id);
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingMarkerMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginMarkerMutation, finishMarkerMutation]);

  const saveMarkerUpdate = useCallback(async (draft: Marker): Promise<boolean> => {
    const map = currentMapRef.current;
    const previous = objectsRef.current.find(
      (object): object is Marker => object.id === draft.id && object.objectType === 'marker',
    );
    if (
      map === null ||
      mapActionInFlightRef.current ||
      previous === undefined ||
      previous.mapId !== map.id ||
      previous.objectVersion < 1 ||
      !beginMarkerMutation(map.id, draft.id)
    ) {
      return false;
    }

    const mapId = map.id;
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, draft.id);
    pendingSaveCountRef.current += 1;
    setPendingMarkerMutationCount((count) => count + 1);
    setObjects((current) => replaceObject(current, draft));
    setSaveError(null);

    try {
      const result = await updateMarker(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        previous.objectVersion,
        draft,
      );
      if (currentMapRef.current?.id !== mapId) {
        return true;
      }
      setObjects((current) => replaceObject(current, result.object));
      updateCurrentMapRevision(mapId, result.mapRevision, result.object.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
      return true;
    } catch (error) {
      if (currentMapRef.current?.id !== mapId) {
        return false;
      }
      if (error instanceof ApiClientError && error.status === 409) {
        await refreshObjectsAfterConflict(mapId, currentMapRef, setCurrentMap, setObjects, setSaveError, localRevisionRef);
      } else {
        setObjects((current) => replaceObject(current, previous));
        setSaveError(toMessage(error, 'Marker update failed.'));
      }
      return false;
    } finally {
      finishMarkerMutation(mapId, draft.id);
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingMarkerMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginMarkerMutation, finishMarkerMutation]);

  const removeMarker = useCallback(async (markerId: Id): Promise<void> => {
    const map = currentMapRef.current;
    const previous = objectsRef.current.find(
      (object): object is Marker => object.id === markerId && object.objectType === 'marker',
    );
    if (
      map === null ||
      mapActionInFlightRef.current ||
      previous === undefined ||
      previous.mapId !== map.id
    ) {
      return;
    }

    const mapId = map.id;
    if (!beginMarkerMutation(mapId, markerId)) {
      return;
    }
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, markerId);
    pendingSaveCountRef.current += 1;
    setPendingMarkerMutationCount((count) => count + 1);
    setObjects((current) => current.filter((object) => object.id !== markerId));
    setSaveError(null);

    try {
      const result = await deleteMarker(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        markerId,
        previous.objectVersion,
      );
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      updateCurrentMapRevision(mapId, result.mapRevision, previous.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
    } catch (error) {
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      if (error instanceof ApiClientError && error.status === 409) {
        await refreshObjectsAfterConflict(mapId, currentMapRef, setCurrentMap, setObjects, setSaveError, localRevisionRef);
      } else {
        setObjects((current) => replaceObject(current, previous));
        setSaveError(toMessage(error, 'Marker deletion failed.'));
      }
    } finally {
      finishMarkerMutation(mapId, markerId);
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingMarkerMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginMarkerMutation, finishMarkerMutation]);

  const saveLabel = useCallback(async (gesture: CompletedLabelGesture): Promise<Label | null> => {
    const map = currentMapRef.current;
    if (map === null || mapActionInFlightRef.current || !beginLabelMutation(map.id, gesture.id)) {
      return null;
    }

    const mapId = map.id;
    const optimistic = createOptimisticLabel({ ...gesture, mapId });
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, gesture.id);
    pendingSaveCountRef.current += 1;
    setPendingLabelMutationCount((count) => count + 1);
    setPendingLabels((current) => [...current, optimistic]);
    setSaveError(null);

    try {
      const result = await createLabel(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        { ...gesture, objectType: 'label' },
      );
      if (currentMapRef.current?.id !== mapId) return null;
      setPendingLabels((current) => current.filter((label) => label.id !== gesture.id));
      setObjects((current) => replaceObject(current, result.object));
      updateCurrentMapRevision(mapId, result.mapRevision, result.object.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
      return result.object;
    } catch (error) {
      if (currentMapRef.current?.id === mapId) {
        setPendingLabels((current) => current.filter((label) => label.id !== gesture.id));
        setSaveError(toMessage(error, 'Text save failed.'));
      }
      return null;
    } finally {
      finishLabelMutation(mapId, gesture.id);
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingLabelMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginLabelMutation, finishLabelMutation]);

  const saveLabelUpdate = useCallback(async (draft: Label): Promise<boolean> => {
    const map = currentMapRef.current;
    const previous = objectsRef.current.find(
      (object): object is Label => object.id === draft.id && object.objectType === 'label',
    );
    if (
      map === null ||
      mapActionInFlightRef.current ||
      previous === undefined ||
      previous.mapId !== map.id ||
      previous.objectVersion < 1 ||
      !beginLabelMutation(map.id, draft.id)
    ) {
      return false;
    }

    const mapId = map.id;
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, draft.id);
    pendingSaveCountRef.current += 1;
    setPendingLabelMutationCount((count) => count + 1);
    setObjects((current) => replaceObject(current, draft));
    setSaveError(null);

    try {
      const result = await updateLabel(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        previous.objectVersion,
        draft,
      );
      if (currentMapRef.current?.id !== mapId) return true;
      setObjects((current) => replaceObject(current, result.object));
      updateCurrentMapRevision(mapId, result.mapRevision, result.object.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
      return true;
    } catch (error) {
      if (currentMapRef.current?.id !== mapId) return false;
      if (error instanceof ApiClientError && error.status === 409) {
        await refreshObjectsAfterConflict(mapId, currentMapRef, setCurrentMap, setObjects, setSaveError, localRevisionRef);
      } else {
        setObjects((current) => replaceObject(current, previous));
        setSaveError(toMessage(error, 'Text update failed.'));
      }
      return false;
    } finally {
      finishLabelMutation(mapId, draft.id);
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingLabelMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginLabelMutation, finishLabelMutation]);

  const removeLabel = useCallback(async (labelId: Id): Promise<void> => {
    const map = currentMapRef.current;
    const previous = objectsRef.current.find(
      (object): object is Label => object.id === labelId && object.objectType === 'label',
    );
    if (map === null || mapActionInFlightRef.current || previous === undefined || previous.mapId !== map.id || !beginLabelMutation(map.id, labelId)) {
      return;
    }

    const mapId = map.id;
    const clientOperationId = crypto.randomUUID();
    trackPendingOperation(clientOperationId, mapId, labelId);
    pendingSaveCountRef.current += 1;
    setPendingLabelMutationCount((count) => count + 1);
    setObjects((current) => current.filter((object) => object.id !== labelId));
    setSaveError(null);

    try {
      const result = await deleteLabel(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
        labelId,
        previous.objectVersion,
      );
      if (currentMapRef.current?.id !== mapId) return;
      updateCurrentMapRevision(mapId, result.mapRevision, previous.orderKey, result.object.updatedAt, currentMapRef, setCurrentMap, localRevisionRef);
    } catch (error) {
      if (currentMapRef.current?.id !== mapId) return;
      if (error instanceof ApiClientError && error.status === 409) {
        await refreshObjectsAfterConflict(mapId, currentMapRef, setCurrentMap, setObjects, setSaveError, localRevisionRef);
      } else {
        setObjects((current) => replaceObject(current, previous));
        setSaveError(toMessage(error, 'Text deletion failed.'));
      }
    } finally {
      finishLabelMutation(mapId, labelId);
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      setPendingLabelMutationCount((count) => Math.max(0, count - 1));
    }
  }, [beginLabelMutation, finishLabelMutation]);

  const undoCurrentChange = useCallback(async (): Promise<void> => {
    const map = currentMapRef.current;
    if (map === null || mapActionInFlightRef.current || historyInFlightRef.current) {
      return;
    }
    if (pendingSaveCountRef.current > 0) {
      setUndoMessage('Wait for the active save to finish before undoing.');
      return;
    }

    const mapId = map.id;
    const clientOperationId = crypto.randomUUID();
    historyInFlightRef.current = true;
    pendingSaveCountRef.current += 1;
    trackPendingOperation(clientOperationId, mapId, '');
    setUndoPending(true);
    setUndoMessage(null);

    try {
      const result = await requestUndo(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
      );
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      if (!result.undone) {
        setUndoMessage('Nothing to undo.');
        return;
      }

      // The inverse is an ordinary authoritative mutation and may arrive on
      // the socket before or after this response. Reloading the committed
      // state makes both orderings converge without a second client store.
      const state = await loadMapState(mapId);
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      applyLoadedMap(state, undefined, false);
    } catch (error) {
      if (currentMapRef.current?.id === mapId) {
        setUndoMessage(toMessage(error, 'Undo failed.'));
      }
    } finally {
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      historyInFlightRef.current = false;
      setUndoPending(false);
    }
  }, [applyLoadedMap, finishPendingMutation, trackPendingOperation]);

  const redoCurrentChange = useCallback(async (): Promise<void> => {
    const map = currentMapRef.current;
    if (map === null || mapActionInFlightRef.current || historyInFlightRef.current) {
      return;
    }
    if (pendingSaveCountRef.current > 0) {
      setUndoMessage('Wait for the active save to finish before redoing.');
      return;
    }

    const mapId = map.id;
    const clientOperationId = crypto.randomUUID();
    historyInFlightRef.current = true;
    pendingSaveCountRef.current += 1;
    trackPendingOperation(clientOperationId, mapId, '');
    setRedoPending(true);
    setUndoMessage(null);

    try {
      const result = await requestRedo(
        mapId,
        actorIdRef.current ?? (actorIdRef.current = actorId()),
        clientOperationId,
      );
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      if (!result.redone) {
        setUndoMessage('Nothing to redo.');
        return;
      }

      const state = await loadMapState(mapId);
      if (currentMapRef.current?.id !== mapId) {
        return;
      }
      applyLoadedMap(state, undefined, false);
    } catch (error) {
      if (currentMapRef.current?.id === mapId) {
        setUndoMessage(toMessage(error, 'Redo failed.'));
      }
    } finally {
      pendingOperationIdsRef.current.delete(clientOperationId);
      finishPendingMutation();
      historyInFlightRef.current = false;
      setRedoPending(false);
    }
  }, [applyLoadedMap, finishPendingMutation, trackPendingOperation]);

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

  const markers = useMemo(
    () =>
      [...objects.filter(isMarker), ...pendingMarkers].sort(
        (left, right) => left.layer - right.layer || left.orderKey - right.orderKey,
      ),
    [objects, pendingMarkers],
  );

  const labels = useMemo(
    () =>
      [...objects.filter(isLabel), ...pendingLabels].sort(
        (left, right) => left.layer - right.layer || left.orderKey - right.orderKey,
      ),
    [objects, pendingLabels],
  );

  return {
    camera,
    setCamera,
    maps,
    currentMap,
    strokes,
    paths,
    markers,
    labels,
    pendingStrokeCount: pendingStrokes.length,
    pendingPathMutationCount,
    pendingMarkerMutationCount,
    pendingLabelMutationCount,
    pendingPathIds,
    pendingMarkerIds,
    pendingLabelIds,
    loadState,
    loadError,
    saveError,
    mapError,
    mapActionBusy,
    undoMessage,
    undoPending,
    redoPending,
    collaborationStatus,
    mapActionsDisabled:
      mapActionBusy ||
      pendingStrokes.length > 0 ||
      pendingPathMutationCount > 0 ||
      pendingMarkerMutationCount > 0 ||
      pendingLabelMutationCount > 0 ||
      undoPending ||
      redoPending ||
      loadState === 'loading',
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
    saveMarker,
    saveMarkerUpdate,
    removeMarker,
    saveLabel,
    saveLabelUpdate,
    removeLabel,
    undo: undoCurrentChange,
    redo: redoCurrentChange,
  };
}

function isBiomeStroke(object: MapObject): object is BiomeStroke {
  return object.objectType === 'biome_stroke';
}

function isPath(object: MapObject): object is Path {
  return object.objectType === 'path';
}

function isMarker(object: MapObject): object is Marker {
  return object.objectType === 'marker';
}

function isLabel(object: MapObject): object is Label {
  return object.objectType === 'label';
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
  localRevisionRef: { current: number },
): void {
  if (currentMapRef.current?.id === mapId && mapRevision >= currentMapRef.current.revision) {
    localRevisionRef.current = mapRevision;
  }
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
  localRevisionRef: { current: number },
): Promise<void> {
  try {
    const state = await loadMapState(mapId);
    if (currentMapRef.current?.id !== mapId) {
      return;
    }
    currentMapRef.current = state.map;
    localRevisionRef.current = state.map.revision;
    setCurrentMap(state.map);
    setObjects(state.objects);
    setSaveError('Map object changed elsewhere; the current map state was reloaded.');
  } catch (error) {
    if (currentMapRef.current?.id === mapId) {
      setSaveError(toMessage(error, 'Object conflict detected; unable to reload the current map.'));
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
