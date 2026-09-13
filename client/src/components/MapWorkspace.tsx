import { useEffect, useRef, useState } from 'react';
import type { Biome, PathGeometryType, WorldPoint } from '../../../shared/domain';
import { MapMenu } from './MapMenu';
import { MapToolbar } from './MapToolbar';
import { MapCanvas, type MapCanvasHandle } from './map/MapCanvas';
import { useMapSession } from '../state/useMapSession';
import type { MapTool } from '../state/mapTool';

const DEFAULT_BIOME: Biome = 'meadows';
const DEFAULT_BRUSH_WIDTH = 120;

export function MapWorkspace() {
  const canvasRef = useRef<MapCanvasHandle>(null);
  const mapSession = useMapSession();
  const [cursorWorld, setCursorWorld] = useState<WorldPoint | null>(null);
  const [tool, setTool] = useState<MapTool>('pan');
  const [biome, setBiome] = useState<Biome>(DEFAULT_BIOME);
  const [brushWidth, setBrushWidth] = useState(DEFAULT_BRUSH_WIDTH);
  const [gridVisible, setGridVisible] = useState(false);
  const [pathsVisible, setPathsVisible] = useState(true);
  const [pathGeometryType, setPathGeometryType] = useState<PathGeometryType>('freehand');
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPathId(null);
  }, [mapSession.currentMap?.id]);

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
        case 'p':
          setTool('path');
          break;
        case 'v':
          setTool('select');
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
        camera={mapSession.camera}
        tool={tool}
        biome={biome}
        brushWidth={brushWidth}
        strokes={mapSession.strokes}
        paths={mapSession.paths}
        pathsVisible={pathsVisible}
        pathGeometryType={pathGeometryType}
        selectedPathId={selectedPathId}
        gridVisible={gridVisible}
        mapId={mapSession.currentMap?.id ?? null}
        interactionEnabled={mapSession.loadState === 'ready' && !mapSession.mapActionBusy}
        onCameraChange={mapSession.setCamera}
        onCursorWorldChange={setCursorWorld}
        onStrokeComplete={mapSession.saveStroke}
        onPathComplete={mapSession.savePath}
        onPathUpdate={mapSession.savePathUpdate}
        onPathDelete={mapSession.removePath}
        onPathSelectionChange={setSelectedPathId}
      />

      <MapMenu
        maps={mapSession.maps}
        currentMapId={mapSession.currentMap?.id ?? null}
        disabled={mapSession.mapActionsDisabled}
        error={mapSession.mapError}
        onSelectMap={mapSession.switchMap}
        onCreateMap={mapSession.createAndSelectMap}
        onRenameMap={mapSession.renameExistingMap}
        onDuplicateMap={mapSession.duplicateAndSelectMap}
        onDeleteMap={mapSession.deleteExistingMap}
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
        <button
          type="button"
          aria-pressed={pathsVisible}
          onClick={() => {
            setPathsVisible((visible) => !visible);
            setSelectedPathId(null);
          }}
        >
          Paths
        </button>
        {mapSession.currentMap !== null && (
          <span className="map-controls__map-name">Map: {mapSession.currentMap.name}</span>
        )}
      </nav>

      <MapToolbar
        tool={tool}
        biome={biome}
        brushWidth={brushWidth}
        pathGeometryType={pathGeometryType}
        hasSelectedPath={selectedPathId !== null}
        onToolChange={setTool}
        onBiomeChange={setBiome}
        onBrushWidthChange={setBrushWidth}
        onPathGeometryTypeChange={setPathGeometryType}
        onDeleteSelectedPath={() => canvasRef.current?.deleteSelectedPath()}
      />

      <aside className="north-indicator" aria-label="North points up">
        <span aria-hidden="true">↑</span>
        <span>N</span>
      </aside>

      <output className="map-debug" aria-live="polite">
        <div>Zoom: {(mapSession.camera.zoom * 100).toFixed(0)}%</div>
        <div>Cursor world X: {formatCoordinate(cursorWorld?.[0])}</div>
        <div>Cursor world Y: {formatCoordinate(cursorWorld?.[1])}</div>
        <div>Strokes: {mapSession.strokes.length}</div>
        {mapSession.pendingStrokeCount + mapSession.pendingPathMutationCount > 0 && <div>Saving…</div>}
        {mapSession.saveError !== null && <div className="map-debug__error">Save failed: {mapSession.saveError}</div>}
      </output>

      {mapSession.loadState !== 'ready' && (
        <section className="map-loading" role={mapSession.loadState === 'error' ? 'alert' : 'status'}>
          {mapSession.loadState === 'loading' ? (
            'Loading map…'
          ) : (
            <>
              <span>Could not load saved map: {mapSession.loadError}</span>
              <button type="button" onClick={() => void mapSession.retryBootstrap()}>
                Retry
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
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
