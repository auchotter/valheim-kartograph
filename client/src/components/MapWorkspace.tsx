import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Biome, BiomeStroke, Id, MapObject, MapRecord, WorldPoint } from '../../../shared/domain';
import { createMap, listMaps, loadMapState } from '../api/maps';
import { createBiomeStroke } from '../api/objects';
import { actorId, rememberedMapId, rememberMapId } from '../lib/browserIdentity';
import { createOptimisticBiomeStroke, type CompletedBrushGesture } from '../lib/biomeStroke';
import { DEFAULT_CAMERA, type Camera } from '../lib/camera';
import type { MapTool } from '../state/mapTool';
import { MapCanvas, type MapCanvasHandle } from './map/MapCanvas';
import { MapToolbar } from './MapToolbar';

const DEFAULT_BIOME: Biome = 'meadows';
const DEFAULT_BRUSH_WIDTH = 120;

export function MapWorkspace() {
  const canvasRef = useRef<MapCanvasHandle>(null);
  const currentMapRef = useRef<MapRecord | null>(null);
  const actorIdRef = useRef<Id | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [cursorWorld, setCursorWorld] = useState<WorldPoint | null>(null);
  const [tool, setTool] = useState<MapTool>('pan');
  const [biome, setBiome] = useState<Biome>(DEFAULT_BIOME);
  const [brushWidth, setBrushWidth] = useState(DEFAULT_BRUSH_WIDTH);
  const [currentMap, setCurrentMap] = useState<MapRecord | null>(null);
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [pendingStrokes, setPendingStrokes] = useState<BiomeStroke[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [gridVisible, setGridVisible] = useState(false);

  useEffect(() => {
    currentMapRef.current = currentMap;
  }, [currentMap]);

  useEffect(() => {
    let disposed = false;
    setLoadState('loading');
    setLoadError(null);

    void bootstrapCurrentMap()
      .then(({ map, objects: loadedObjects }) => {
        if (disposed) {
          return;
        }
        currentMapRef.current = map;
        setCurrentMap(map);
        setObjects(loadedObjects);
        setPendingStrokes([]);
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        setLoadState('error');
        setLoadError(error instanceof Error ? error.message : 'Unable to load the current map.');
      });

    return () => {
      disposed = true;
    };
  }, [reloadAttempt]);

  const strokes = useMemo(
    () =>
      [...objects.filter(isBiomeStroke), ...pendingStrokes].sort(
        (left, right) => left.layer - right.layer || left.orderKey - right.orderKey,
      ),
    [objects, pendingStrokes],
  );

  const handleCameraChange = useCallback((nextCamera: Camera) => {
    setCamera(nextCamera);
  }, []);

  const handleCursorWorldChange = useCallback((point: WorldPoint) => {
    setCursorWorld(point);
  }, []);

  const handleStrokeComplete = useCallback(async (gesture: CompletedBrushGesture) => {
    const map = currentMapRef.current;
    if (map === null) {
      return;
    }

    const id = crypto.randomUUID();
    const optimistic = createOptimisticBiomeStroke({ ...gesture, mapId: map.id, id });
    const clientOperationId = crypto.randomUUID();
    setPendingStrokes((current) => [...current, optimistic]);
    setSaveError(null);

    try {
      const result = await createBiomeStroke(
        map.id,
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
      setPendingStrokes((current) => current.filter((stroke) => stroke.id !== id));
      setObjects((current) => [...current.filter((object) => object.id !== result.object.id), result.object]);
      setCurrentMap((current) => {
        if (current === null || current.id !== map.id || result.mapRevision < current.revision) {
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
      setPendingStrokes((current) => current.filter((stroke) => stroke.id !== id));
      setSaveError(error instanceof Error ? error.message : 'Save failed.');
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'h':
          setTool('pan');
          break;
        case 'b':
          setTool('biome_brush');
          break;
        case 'e':
          setTool('eraser');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className="map-workspace">
      <MapCanvas
        ref={canvasRef}
        camera={camera}
        tool={tool}
        biome={biome}
        brushWidth={brushWidth}
        strokes={strokes}
        gridVisible={gridVisible}
        interactionEnabled={loadState === 'ready'}
        onCameraChange={handleCameraChange}
        onCursorWorldChange={handleCursorWorldChange}
        onStrokeComplete={handleStrokeComplete}
      />

      <nav className="map-controls" aria-label="Map viewport controls">
        <button type="button" onClick={() => canvasRef.current?.resetView()}>
          Reset view
        </button>
        <button type="button" onClick={() => canvasRef.current?.zoomToOne()}>
          Zoom to 100%
        </button>
        <button
          type="button"
          aria-pressed={gridVisible}
          onClick={() => setGridVisible((visible) => !visible)}
        >
          Grid
        </button>
        {currentMap !== null && <span className="map-controls__map-name">Map: {currentMap.name}</span>}
      </nav>

      <MapToolbar
        tool={tool}
        biome={biome}
        brushWidth={brushWidth}
        onToolChange={setTool}
        onBiomeChange={setBiome}
        onBrushWidthChange={setBrushWidth}
      />

      <aside className="north-indicator" aria-label="North points up">
        <span aria-hidden="true">↑</span>
        <span>N</span>
      </aside>

      <output className="map-debug" aria-live="polite">
        <div>Zoom: {(camera.zoom * 100).toFixed(0)}%</div>
        <div>Cursor world X: {formatCoordinate(cursorWorld?.[0])}</div>
        <div>Cursor world Y: {formatCoordinate(cursorWorld?.[1])}</div>
        <div>Strokes: {strokes.length}</div>
        {pendingStrokes.length > 0 && <div>Saving…</div>}
        {saveError !== null && <div className="map-debug__error">Save failed: {saveError}</div>}
      </output>

      {loadState !== 'ready' && (
        <section className="map-loading" role={loadState === 'error' ? 'alert' : 'status'}>
          {loadState === 'loading' ? (
            'Loading map…'
          ) : (
            <>
              <span>Could not load saved map: {loadError}</span>
              <button type="button" onClick={() => setReloadAttempt((attempt) => attempt + 1)}>
                Retry
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}

async function bootstrapCurrentMap(): Promise<{ map: MapRecord; objects: MapObject[] }> {
  let maps = await listMaps();
  if (maps.length === 0) {
    try {
      maps = [await createMap('Our World')];
    } catch (error) {
      // React StrictMode or another browser may have won creation first.
      maps = await listMaps();
      if (maps.length === 0) {
        throw error;
      }
    }
  }

  const remembered = rememberedMapId();
  const map = maps.find((candidate) => candidate.id === remembered) ?? maps[0];
  const state = await loadMapState(map.id);
  rememberMapId(state.map.id);
  return state;
}

function isBiomeStroke(object: MapObject): object is BiomeStroke {
  return object.objectType === 'biome_stroke';
}

function formatCoordinate(value: number | undefined): string {
  return value === undefined ? '—' : Math.round(value).toString();
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
