import { useCallback, useEffect, useRef, useState } from 'react';
import type { Biome, Marker, PathGeometryType, WorldPoint } from '../../../shared/domain';
import { MapMenu } from './MapMenu';
import { MarkerInspector } from './MarkerInspector';
import { MarkerPalette } from './MarkerPalette';
import { MapToolbar } from './MapToolbar';
import { MapCanvas, type MapCanvasHandle } from './map/MapCanvas';
import { useMapSession } from '../state/useMapSession';
import type { MapTool } from '../state/mapTool';
import { mapToValheimCoordinates } from '../lib/valheimCoordinates';
import { CoordinateNavigator } from './CoordinateNavigator';
import { clearMarkerInteraction, toggleArmedMarkerType } from '../lib/markerPlacement';

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
  const [armedMarkerType, setArmedMarkerType] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [markerPreview, setMarkerPreview] = useState<Marker | null>(null);

  useEffect(() => {
    const cleared = clearMarkerInteraction();
    setSelectedPathId(null);
    setSelectedMarkerId(cleared.selectedMarkerId);
    setMarkerPreview(null);
    setArmedMarkerType(cleared.armedMarkerType);
  }, [mapSession.currentMap?.id]);

  const changeTool = useCallback((nextTool: MapTool) => {
    setTool(nextTool);
    if (nextTool !== 'marker') {
      setArmedMarkerType(null);
    }
    if (nextTool === 'pan' || nextTool === 'biome_brush' || nextTool === 'eraser' || nextTool === 'path') {
      const cleared = clearMarkerInteraction();
      setSelectedMarkerId(cleared.selectedMarkerId);
      setMarkerPreview(null);
    }
  }, []);

  const toggleMarkerPlacement = useCallback((markerType: string) => {
    setTool('marker');
    setArmedMarkerType((current) => toggleArmedMarkerType(current, markerType));
  }, []);

  const disarmMarkerPlacement = useCallback(() => {
    setArmedMarkerType(null);
  }, []);

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
  const cursorValheim = cursorWorld === null ? null : mapToValheimCoordinates(cursorWorld[0], cursorWorld[1]);

  const goToCoordinate = useCallback(
    (coordinate: { x: number; y: number }) => {
      mapSession.setCamera({ ...mapSession.camera, cameraX: coordinate.x, cameraY: coordinate.y });
    },
    [mapSession.camera, mapSession.setCamera],
  );

  const requestUndo = useCallback(() => {
    canvasRef.current?.cancelTransientInteraction();
    void mapSession.undo();
  }, [mapSession.undo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        requestUndo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'h':
          changeTool('pan');
          break;
        case 'b':
          changeTool('biome_brush');
          break;
        case 'e':
          changeTool('eraser');
          break;
        case 'p':
          changeTool('path');
          break;
        case 'v':
          changeTool('select');
          break;
        case 'm':
          changeTool('marker');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeTool, requestUndo]);

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
        armedMarkerType={armedMarkerType}
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
        onMarkerPlacementDisarm={disarmMarkerPlacement}
        onToolChange={changeTool}
      />

      {gridVisible && <div className="map-centre-reticle" aria-hidden="true" />}

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
        <button type="button" onClick={requestUndo} disabled={mapSession.undoPending}>
          Undo
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
        <CoordinateNavigator onGo={goToCoordinate} />
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
        onToolChange={changeTool}
        onBiomeChange={setBiome}
        onBrushWidthChange={setBrushWidth}
        onPathGeometryTypeChange={setPathGeometryType}
        onDeleteSelectedPath={() => canvasRef.current?.deleteSelectedPath()}
      />

      {tool === 'marker' && (
        <MarkerPalette armedMarkerType={armedMarkerType} onMarkerTypeChange={toggleMarkerPlacement} />
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
        <div>Cursor Valheim X: {formatCoordinate(cursorValheim?.x)}</div>
        <div>Cursor Valheim Z: {formatCoordinate(cursorValheim?.z)}</div>
        {mapSession.collaborationStatus !== 'connected' && (
          <div>Sync: {formatCollaborationStatus(mapSession.collaborationStatus)}</div>
        )}
        {mapSession.pendingStrokeCount + mapSession.pendingPathMutationCount + mapSession.pendingMarkerMutationCount > 0 && <div>Saving…</div>}
        {mapSession.saveError !== null && <div className="map-debug__error">Save failed: {mapSession.saveError}</div>}
        {mapSession.undoMessage !== null && <div>{mapSession.undoMessage}</div>}
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
