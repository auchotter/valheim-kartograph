import { useCallback, useEffect, useRef, useState } from 'react';
import type { Biome, Marker, PathGeometryType, WorldPoint } from '../../../shared/domain';
import { MapMenu } from './MapMenu';
import { MarkerInspector } from './MarkerInspector';
import { MarkerPalette } from './MarkerPalette';
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
  const [activeMarkerType, setActiveMarkerType] = useState('home');
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [markerPreview, setMarkerPreview] = useState<Marker | null>(null);

  useEffect(() => {
    setSelectedPathId(null);
    setSelectedMarkerId(null);
    setMarkerPreview(null);
  }, [mapSession.currentMap?.id]);

  const selectPath = useCallback((pathId: string | null) => {
    setSelectedPathId(pathId);
    if (pathId !== null) {
      setSelectedMarkerId(null);
      setMarkerPreview(null);
    }
  }, []);

  const selectMarker = useCallback((markerId: string | null) => {
    setSelectedMarkerId(markerId);
    if (markerId !== null) {
      setSelectedPathId(null);
    }
    if (markerId === null) {
      setMarkerPreview(null);
    }
  }, []);

  const updateMarker = useCallback(
    (marker: Marker) => {
      setMarkerPreview(null);
      void mapSession.saveMarkerUpdate(marker);
    },
    [mapSession.saveMarkerUpdate],
  );

  const deleteMarker = useCallback(
    (markerId: string) => {
      setSelectedMarkerId(null);
      setMarkerPreview(null);
      void mapSession.removeMarker(markerId);
    },
    [mapSession.removeMarker],
  );

  const selectedMarker = mapSession.markers.find((marker) => marker.id === selectedMarkerId) ?? null;

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
        case 'm':
          setTool('marker');
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
        markers={mapSession.markers}
        pendingPathIds={mapSession.pendingPathIds}
        pendingMarkerIds={mapSession.pendingMarkerIds}
        pathsVisible={pathsVisible}
        pathGeometryType={pathGeometryType}
        activeMarkerType={activeMarkerType}
        selectedPathId={selectedPathId}
        selectedMarkerId={selectedMarkerId}
        markerPreview={markerPreview}
        gridVisible={gridVisible}
        mapId={mapSession.currentMap?.id ?? null}
        interactionEnabled={mapSession.loadState === 'ready' && !mapSession.mapActionBusy}
        onCameraChange={mapSession.setCamera}
        onCursorWorldChange={setCursorWorld}
        onStrokeComplete={mapSession.saveStroke}
        onPathComplete={mapSession.savePath}
        onPathUpdate={mapSession.savePathUpdate}
        onPathDelete={mapSession.removePath}
        onPathSelectionChange={selectPath}
        onMarkerComplete={mapSession.saveMarker}
        onMarkerUpdate={updateMarker}
        onMarkerDelete={deleteMarker}
        onMarkerSelectionChange={selectMarker}
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
        selectedPathPending={selectedPathId !== null && mapSession.pendingPathIds.has(selectedPathId)}
        onToolChange={setTool}
        onBiomeChange={setBiome}
        onBrushWidthChange={setBrushWidth}
        onPathGeometryTypeChange={setPathGeometryType}
        onDeleteSelectedPath={() => canvasRef.current?.deleteSelectedPath()}
      />

      {tool === 'marker' && (
        <MarkerPalette activeMarkerType={activeMarkerType} onMarkerTypeChange={setActiveMarkerType} />
      )}

      {selectedMarker !== null && (
        <MarkerInspector
          marker={selectedMarker}
          disabled={
            selectedMarker.objectVersion < 1 ||
            mapSession.pendingMarkerIds.has(selectedMarker.id)
          }
          onUpdate={updateMarker}
          onPreview={setMarkerPreview}
          onDelete={deleteMarker}
        />
      )}

      <aside className="north-indicator" aria-label="North points up">
        <span aria-hidden="true">↑</span>
        <span>N</span>
      </aside>

      <output className="map-debug" aria-live="polite">
        <div>Zoom: {(mapSession.camera.zoom * 100).toFixed(0)}%</div>
        <div>Cursor world X: {formatCoordinate(cursorWorld?.[0])}</div>
        <div>Cursor world Y: {formatCoordinate(cursorWorld?.[1])}</div>
        <div>Strokes: {mapSession.strokes.length}</div>
        <div>Markers: {mapSession.markers.length}</div>
        {mapSession.collaborationStatus !== 'connected' && (
          <div>Sync: {formatCollaborationStatus(mapSession.collaborationStatus)}</div>
        )}
        {mapSession.pendingStrokeCount + mapSession.pendingPathMutationCount + mapSession.pendingMarkerMutationCount > 0 && <div>Saving…</div>}
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

function formatCollaborationStatus(status: string): string {
  return status === 'reconnecting' ? 'Reconnecting…' : status[0].toUpperCase() + status.slice(1);
}
