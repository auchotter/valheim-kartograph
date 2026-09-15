import { useCallback, useEffect, useRef, useState } from 'react';
import type { Biome, Marker, PathGeometryType, WorldPoint } from '../../../shared/domain';
import { MapMenu } from './MapMenu';
import { MarkerInspector } from './MarkerInspector';
import { MarkerGallery } from './MarkerGallery';
import { MapToolbar } from './MapToolbar';
import { MapCanvas, type MapCanvasHandle } from './map/MapCanvas';
import { useMapSession } from '../state/useMapSession';
import type { MapTool } from '../state/mapTool';
import { mapToValheimCoordinates } from '../lib/valheimCoordinates';
import { CoordinateNavigator } from './CoordinateNavigator';
import { ResponsiveOverflowBar, type ResponsiveOverflowItem } from './ResponsiveOverflowBar';
import { useHudLayout } from '../state/useHudLayout';
import { clearMarkerInteraction } from '../lib/markerPlacement';
import { nextPathOpacity, pathOpacityLabel, type PathOpacity } from '../lib/pathVisibility';
import { readMapUiPreferences, writeMapUiPreferences, type DebugCoordinateMode } from '../lib/mapUiPreferences';
import { readMapAppearance, writeMapAppearance, type MapAppearance } from '../lib/mapAppearance';
import compassRoseUrl from '../assets/ui/compass-rose.png';
import { isVegvisirMarker, normaliseDirectionDegrees } from '../lib/markerIcons';
import { markerWithDirection } from '../lib/markerGeometry';

const DEFAULT_BIOME: Biome = 'meadows';
const DEFAULT_BRUSH_WIDTH = 120;
type DebugInfoView = 'readout' | 'settings';

export function MapWorkspace() {
  const layoutMode = useHudLayout();
  const canvasRef = useRef<MapCanvasHandle>(null);
  const mapSession = useMapSession();
  const [cursorWorld, setCursorWorld] = useState<WorldPoint | null>(null);
  const toolsHudRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<MapTool>('pan');
  const [biome, setBiome] = useState<Biome>(DEFAULT_BIOME);
  const [brushWidth, setBrushWidth] = useState(DEFAULT_BRUSH_WIDTH);
  const [initialUiPreferences] = useState(() => readMapUiPreferences());
  const [initialAppearance] = useState<MapAppearance>(() => readMapAppearance());
  const [appearance] = useState<MapAppearance>(initialAppearance);
  const [gridVisible, setGridVisible] = useState(initialUiPreferences.gridEnabled);
  const [pathOpacity, setPathOpacity] = useState<PathOpacity>(initialUiPreferences.pathOpacity);
  const [protectEnabled, setProtectEnabled] = useState(initialUiPreferences.protectEnabled);
  const [pathGeometryType, setPathGeometryType] = useState<PathGeometryType>('freehand');
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [armedMarkerType, setArmedMarkerType] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [markerPreview, setMarkerPreview] = useState<Marker | null>(null);
  const [markerCaptionDrafts, setMarkerCaptionDrafts] = useState<Record<string, string>>({});
  const [markerGalleryOpen, setMarkerGalleryOpen] = useState(false);
  const [coordinateNavigatorOpen, setCoordinateNavigatorOpen] = useState(false);
  const [coordinateNavigatorAnchor, setCoordinateNavigatorAnchor] = useState<DOMRectReadOnly | null>(null);
  const [debugInfoOpen, setDebugInfoOpen] = useState(initialUiPreferences.debugOpen);
  const [debugInfoView, setDebugInfoView] = useState<DebugInfoView>('readout');
  const [debugCoordinateMode, setDebugCoordinateMode] = useState<DebugCoordinateMode>(initialUiPreferences.debugCoordinateMode);
  const debugInfoRef = useRef<HTMLDivElement>(null);
  const vegvisirDirectionPreviewRef = useRef<number | null>(null);

  useEffect(() => {
    writeMapUiPreferences({
      pathOpacity,
      protectEnabled,
      gridEnabled: gridVisible,
      debugOpen: debugInfoOpen,
      debugCoordinateMode,
    });
  }, [debugCoordinateMode, debugInfoOpen, gridVisible, pathOpacity, protectEnabled]);

  useEffect(() => {
    writeMapAppearance(appearance);
  }, [appearance]);

  const closeDebugInfo = useCallback(() => {
    setDebugInfoOpen(false);
    setDebugInfoView('readout');
  }, []);

  useEffect(() => {
    if (!debugInfoOpen) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (appearance !== 'immersive' && !debugInfoRef.current?.contains(event.target as Node)) {
        closeDebugInfo();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      event.stopPropagation();
      if (debugInfoView === 'settings') {
        setDebugInfoView('readout');
      } else {
        closeDebugInfo();
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [appearance, closeDebugInfo, debugInfoOpen, debugInfoView]);

  useEffect(() => {
    const cleared = clearMarkerInteraction();
    setSelectedPathId(null);
    setSelectedMarkerId(cleared.selectedMarkerId);
    setMarkerPreview(null);
    setArmedMarkerType(cleared.armedMarkerType);
    setMarkerCaptionDrafts({});
    setMarkerGalleryOpen(false);
    vegvisirDirectionPreviewRef.current = null;
  }, [mapSession.currentMap?.id]);

  const enterNeutralPan = useCallback(() => {
    setTool('pan');
    setMarkerGalleryOpen(false);
    const cleared = clearMarkerInteraction();
    setArmedMarkerType(cleared.armedMarkerType);
    setSelectedMarkerId(cleared.selectedMarkerId);
    setSelectedPathId(null);
    setMarkerPreview(null);
  }, []);

  const changeTool = useCallback((nextTool: MapTool) => {
    if (nextTool === 'pan') {
      enterNeutralPan();
      return;
    }
    setTool(nextTool);
    setMarkerGalleryOpen(nextTool === 'marker');
    if (nextTool !== 'marker') {
      setArmedMarkerType(null);
    }
    if (nextTool === 'biome_brush' || nextTool === 'eraser' || nextTool === 'path') {
      const cleared = clearMarkerInteraction();
      setSelectedMarkerId(cleared.selectedMarkerId);
      setMarkerPreview(null);
    }
  }, [enterNeutralPan]);

  const selectMarkerGalleryItem = useCallback((markerType: string) => {
    setTool('marker');
    setArmedMarkerType(markerType);
    setMarkerGalleryOpen(false);
  }, []);

  const closeMarkerGallery = useCallback(() => {
    setMarkerGalleryOpen(false);
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
    vegvisirDirectionPreviewRef.current = null;
    if (markerId !== null) {
      setSelectedPathId(null);
    }
    if (markerId === null) {
      setMarkerPreview(null);
    }
  }, []);

  const updateMarker = useCallback(
    async (marker: Marker): Promise<boolean> => {
      setMarkerPreview(null);
      return mapSession.saveMarkerUpdate(marker);
    },
    [mapSession.saveMarkerUpdate],
  );

  const updateMarkerCaptionDraft = useCallback((markerId: string, draft: string | null) => {
    setMarkerCaptionDrafts((current) => {
      if (draft === null) {
        if (!(markerId in current)) {
          return current;
        }
        const { [markerId]: _discarded, ...remaining } = current;
        return remaining;
      }
      return current[markerId] === draft ? current : { ...current, [markerId]: draft };
    });
  }, []);

  const deleteMarker = useCallback(
    (markerId: string) => {
      setSelectedMarkerId(null);
      setMarkerPreview(null);
      updateMarkerCaptionDraft(markerId, null);
      void mapSession.removeMarker(markerId);
    },
    [mapSession.removeMarker, updateMarkerCaptionDraft],
  );

  const deleteSelectedMarker = useCallback(() => {
    if (selectedMarkerId !== null) {
      deleteMarker(selectedMarkerId);
    }
  }, [deleteMarker, selectedMarkerId]);

  const selectedMarker = mapSession.markers.find((marker) => marker.id === selectedMarkerId) ?? null;
  const previewVegvisirDirection = useCallback((directionDegrees: number) => {
    if (selectedMarker === null || !isVegvisirMarker(selectedMarker.markerType)) {
      return;
    }
    const direction = normaliseDirectionDegrees(directionDegrees);
    vegvisirDirectionPreviewRef.current = direction;
    setMarkerPreview(markerWithDirection(selectedMarker, direction));
  }, [selectedMarker]);

  const commitVegvisirDirection = useCallback(() => {
    if (selectedMarker === null || !isVegvisirMarker(selectedMarker.markerType)) {
      return;
    }
    const direction = vegvisirDirectionPreviewRef.current;
    if (direction === null) {
      return;
    }
    vegvisirDirectionPreviewRef.current = null;
    const draft = markerWithDirection(selectedMarker, direction);
    setMarkerPreview(null);
    if (draft.directionDegrees !== selectedMarker.directionDegrees) {
      void updateMarker(draft);
    }
  }, [selectedMarker, updateMarker]);
  const cursorValheim = cursorWorld === null ? null : mapToValheimCoordinates(cursorWorld[0], cursorWorld[1]);
  const centreValheim = mapToValheimCoordinates(mapSession.camera.cameraX, mapSession.camera.cameraY);
  const debugValheim = debugCoordinateMode === 'cursor' ? cursorValheim : centreValheim;

  const openDebugInfo = useCallback(() => {
    setDebugInfoView('readout');
    setDebugInfoOpen(true);
  }, []);

  const selectDebugCoordinateMode = useCallback((mode: DebugCoordinateMode) => {
    setDebugCoordinateMode(mode);
    setDebugInfoView('readout');
  }, []);

  const closeOrBackDebugInfo = useCallback(() => {
    if (debugInfoView === 'settings') {
      setDebugInfoView('readout');
    } else {
      closeDebugInfo();
    }
  }, [closeDebugInfo, debugInfoView]);

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

  const requestRedo = useCallback(() => {
    canvasRef.current?.cancelTransientInteraction();
    void mapSession.redo();
  }, [mapSession.redo]);

  const openCoordinateNavigator = useCallback((trigger: HTMLElement) => {
    setCoordinateNavigatorAnchor(trigger.getBoundingClientRect());
    setCoordinateNavigatorOpen(true);
  }, []);

  const closeCoordinateNavigator = useCallback(() => {
    setCoordinateNavigatorOpen(false);
    setCoordinateNavigatorAnchor(null);
  }, []);

  const utilityItems: ResponsiveOverflowItem[] = [
    {
      id: 'map-library',
      render: () => (
        <MapMenu
          maps={mapSession.maps}
          currentMapId={mapSession.currentMap?.id ?? null}
          showSelectionTick={appearance === 'modern'}
          disabled={mapSession.mapActionsDisabled}
          error={mapSession.mapError}
          onSelectMap={mapSession.switchMap}
          onCreateMap={mapSession.createAndSelectMap}
          onRenameMap={mapSession.renameExistingMap}
          onDuplicateMap={mapSession.duplicateAndSelectMap}
          onDeleteMap={mapSession.deleteExistingMap}
        />
      ),
    },
    {
      id: 'reset-view',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" onClick={() => { canvasRef.current?.resetView(); closeOverflow(); }}>
          Reset view
        </button>
      ),
    },
    {
      id: 'zoom-to-one',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" onClick={() => { canvasRef.current?.zoomToOne(); closeOverflow(); }}>
          Zoom to 100%
        </button>
      ),
    },
    {
      id: 'undo',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" onClick={() => { requestUndo(); closeOverflow(); }} disabled={mapSession.undoPending || mapSession.redoPending}>
          Undo
        </button>
      ),
    },
    {
      id: 'redo',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" onClick={() => { requestRedo(); closeOverflow(); }} disabled={mapSession.redoPending || mapSession.undoPending}>
          Redo
        </button>
      ),
    },
    {
      id: 'grid',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" aria-pressed={gridVisible} onClick={() => { setGridVisible((visible) => !visible); closeOverflow(); }}>
          Grid
        </button>
      ),
    },
    {
      id: 'paths',
      render: ({ closeOverflow }) => (
        <button
          type="button"
          className="utility-control"
          aria-label="Adjust path visibility"
          title="Adjust path visibility"
          onClick={() => { setPathOpacity((opacity) => nextPathOpacity(opacity)); closeOverflow(); }}
        >
          {pathOpacityLabel(pathOpacity)}
        </button>
      ),
    },
    {
      id: 'protect',
      render: ({ closeOverflow }) => (
        <button
          type="button"
          className="utility-control"
          aria-pressed={protectEnabled}
          aria-label="Prevent markers and paths from being selected while using Pan"
          title="Prevent markers and paths from being selected while using Pan"
          onClick={() => {
            const next = !protectEnabled;
            setProtectEnabled(next);
            if (next && tool === 'pan') {
              setSelectedPathId(null);
              setSelectedMarkerId(null);
            }
            closeOverflow();
          }}
        >
          {appearance === 'modern' && <span className="utility-control__state-mark" aria-hidden="true">{protectEnabled ? '✓ ' : ''}</span>}
          Protect
        </button>
      ),
    },
    {
      id: 'coordinate',
      render: ({ closeOverflow }) => (
        <button
          type="button"
          className="utility-control"
          aria-label="Go to Valheim coordinates. In-game, enable the console, press F5, type `pos`, and use the displayed X and Z coordinates"
          title="Go to Valheim coordinates. In-game, enable the console, press F5, type `pos`, and use the displayed X and Z coordinates"
          aria-expanded={coordinateNavigatorOpen}
          aria-haspopup="dialog"
          onClick={(event) => {
            if (coordinateNavigatorOpen) {
              closeCoordinateNavigator();
              return;
            }
            openCoordinateNavigator(event.currentTarget);
            closeOverflow();
          }}
        >
          Add coordinate
        </button>
      ),
    },
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const redoShortcut =
        ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z' && !event.altKey) ||
        (event.ctrlKey && event.key.toLowerCase() === 'y' && !event.metaKey && !event.altKey && !event.shiftKey);
      if (redoShortcut) {
        event.preventDefault();
        requestRedo();
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
  }, [changeTool, requestRedo, requestUndo]);

  return (
    <main className="map-workspace" data-ui-mode={appearance}>
      <MapCanvas
        ref={canvasRef}
        appearance={appearance}
        camera={mapSession.camera}
        tool={tool}
        biome={biome}
        brushWidth={brushWidth}
        strokes={mapSession.strokes}
        paths={mapSession.paths}
        markers={mapSession.markers}
        pendingPathIds={mapSession.pendingPathIds}
        pendingMarkerIds={mapSession.pendingMarkerIds}
        pathOpacity={pathOpacity}
        protectEnabled={protectEnabled}
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

      {appearance === 'immersive' && (
        <img
          className="immersive-compass-rose"
          src={compassRoseUrl}
          alt=""
          aria-hidden="true"
        />
      )}

      <div className="map-top-hud" data-layout-mode={layoutMode}>
        <div className="map-top-hud__utility">
          <ResponsiveOverflowBar ariaLabel="Map viewport controls" className="map-controls" items={utilityItems} mode={layoutMode} group="utility" />
        </div>

        <div ref={toolsHudRef} className="map-top-hud__tools">
          <MapToolbar
            layoutMode={layoutMode}
            immersive={appearance === 'immersive'}
            tool={tool}
            biome={biome}
            brushWidth={brushWidth}
            pathGeometryType={pathGeometryType}
            hasSelectedPath={selectedPathId !== null}
            selectedPathPending={selectedPathId !== null && mapSession.pendingPathIds.has(selectedPathId)}
            hasSelectedMarker={selectedMarkerId !== null}
            selectedMarkerPending={selectedMarkerId !== null && mapSession.pendingMarkerIds.has(selectedMarkerId)}
            selectedMarker={selectedMarker}
            markerCaptionDraft={selectedMarker === null ? undefined : markerCaptionDrafts[selectedMarker.id]}
            selectedVegvisir={selectedMarker !== null && isVegvisirMarker(selectedMarker.markerType)}
            vegvisirDirection={selectedMarker?.directionDegrees ?? 0}
            onToolChange={changeTool}
            onVegvisirDirectionPreview={previewVegvisirDirection}
            onVegvisirDirectionCommit={commitVegvisirDirection}
            onBiomeChange={setBiome}
            onBrushWidthChange={setBrushWidth}
            onPathGeometryTypeChange={setPathGeometryType}
            onDeleteSelectedPath={() => canvasRef.current?.deleteSelectedPath()}
            onDeleteSelectedMarker={deleteSelectedMarker}
            onMarkerCaptionDraftChange={updateMarkerCaptionDraft}
            onMarkerUpdate={updateMarker}
          />
        </div>

      </div>

      <div className="map-popover-layer">
        <CoordinateNavigator
          anchorRect={coordinateNavigatorAnchor}
          open={coordinateNavigatorOpen}
          onClose={closeCoordinateNavigator}
          onGo={goToCoordinate}
        />
      </div>

      <MarkerGallery
        open={tool === 'marker' && markerGalleryOpen}
        anchorRef={toolsHudRef}
        armedMarkerType={armedMarkerType}
        onSelect={selectMarkerGalleryItem}
        onClose={closeMarkerGallery}
      />

      {selectedMarker !== null && appearance !== 'immersive' && (
        <MarkerInspector
          marker={selectedMarker}
          immersive={false}
          disabled={
            selectedMarker.objectVersion < 1 ||
            mapSession.pendingMarkerIds.has(selectedMarker.id)
          }
          captionDraft={markerCaptionDrafts[selectedMarker.id]}
          onCaptionDraftChange={updateMarkerCaptionDraft}
          onUpdate={updateMarker}
          onDirectionPreview={previewVegvisirDirection}
          onDirectionCommit={commitVegvisirDirection}
          onDelete={deleteMarker}
        />
      )}

      <div className="debug-info" ref={debugInfoRef}>
        {appearance === 'immersive' ? (!debugInfoOpen ? (
          <button
            type="button"
            className="debug-info__button immersive-wood-button"
            aria-label="Show debug information"
            aria-controls="debug-info-popup"
            aria-expanded={debugInfoOpen}
            onClick={openDebugInfo}
          >
            <span className="debug-info__symbol" aria-hidden="true">?</span>
          </button>
        ) : (
          <section id="debug-info-popup" className="debug-info__popup" aria-live="polite">
            {debugInfoView === 'settings' ? (
              <section className="debug-info__settings" aria-label="Debug settings">
                <div className="debug-info__settings-line">
                  <h2>Coordinates</h2>
                  <div className="debug-info__actions">
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Debug settings"
                      aria-pressed="true"
                      onClick={() => setDebugInfoView('settings')}
                    >
                      ?
                    </button>
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Back to debug information"
                      onClick={closeOrBackDebugInfo}
                    >
                      X
                    </button>
                  </div>
                </div>
                <div className="debug-info__coordinate-options" role="radiogroup" aria-label="Coordinate source">
                  {(['cursor', 'centre'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className="debug-info__coordinate-option"
                      role="radio"
                      aria-checked={debugCoordinateMode === mode}
                      onClick={() => selectDebugCoordinateMode(mode)}
                    >
                      <span aria-hidden="true">{debugCoordinateMode === mode ? '✓' : ''}</span>
                      {mode === 'cursor' ? 'Cursor' : 'Centre'}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div className="debug-info__readout">
                <div className="debug-info__zoom-line">
                  <span>ZOOM: {(mapSession.camera.zoom * 100).toFixed(0)}%</span>
                  <div className="debug-info__actions">
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Debug settings"
                      onClick={() => setDebugInfoView('settings')}
                    >
                      ?
                    </button>
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Close debug information"
                      onClick={closeOrBackDebugInfo}
                    >
                      X
                    </button>
                  </div>
                </div>
                <div className="debug-info__coordinate-line"><span>X:</span><span>{formatCoordinate(debugValheim?.x)}</span></div>
                <div className="debug-info__coordinate-line"><span>Z:</span><span>{formatCoordinate(debugValheim?.z)}</span></div>
              </div>
            )}
          </section>
        )) : (
          <>
            <button
              type="button"
              className="debug-info__button immersive-wood-button"
              aria-label="Show debug information"
              aria-controls="debug-info-popup"
              aria-expanded={debugInfoOpen}
              onClick={() => setDebugInfoOpen((current) => !current)}
            >
              <span className="debug-info__symbol" aria-hidden="true">i</span>
            </button>
            {debugInfoOpen && (
              <output id="debug-info-popup" className="debug-info__popup" aria-live="polite" onClick={closeDebugInfo}>
                <div>Zoom: {(mapSession.camera.zoom * 100).toFixed(0)}%</div>
                <div>Cursor Valheim X: {formatCoordinate(cursorValheim?.x)}</div>
                <div>Cursor Valheim Z: {formatCoordinate(cursorValheim?.z)}</div>
                {mapSession.collaborationStatus !== 'connected' && (
                  <div>Sync: {formatCollaborationStatus(mapSession.collaborationStatus)}</div>
                )}
                {mapSession.pendingStrokeCount + mapSession.pendingPathMutationCount + mapSession.pendingMarkerMutationCount > 0 && <div>Saving…</div>}
                {mapSession.saveError !== null && <div className="debug-info__error">Save failed: {mapSession.saveError}</div>}
                {mapSession.undoMessage !== null && <div>{mapSession.undoMessage}</div>}
              </output>
            )}
          </>
        )}
      </div>

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
