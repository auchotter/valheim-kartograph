import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import type { Biome, BiomeStroke, Marker, Path, PathGeometryType, WorldPoint } from '../../../../shared/domain';
import { biomeColor } from '../../lib/biomeStyles';
import type { CompletedBrushGesture } from '../../lib/biomeStroke';
import {
  panCameraByScreenDelta,
  screenToWorld,
  zoomAtScreenPoint,
  DEFAULT_CAMERA,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  type Camera,
  type ScreenPoint,
} from '../../lib/camera';
import { simplifyStrokePoints, shouldSamplePoint, strokeSampleDistance } from '../../lib/strokeGeometry';
import {
  DEFAULT_PATH_STROKE_WIDTH,
  hitTestPath,
  midpoint,
  pathSampleDistance,
  replacePathControlPoint,
  type CompletedPathGesture,
} from '../../lib/pathGeometry';
import { hitTestMarker, movedMarker } from '../../lib/markerGeometry';
import { initialPointerGesture, shouldClearPanSelection } from '../../lib/pointerGesture';
import type { CompletedMarkerGesture } from '../../lib/markerObject';
import type { MapTool } from '../../state/mapTool';
import { isBrushTool } from '../../state/mapTool';
import {
  PixiMapRenderer,
  type MarkerPlacementPreview,
  type PathPreview,
  type TerrainPreview,
} from './PixiMapRenderer';

export interface MapCanvasHandle {
  resetView: () => void;
  zoomToOne: () => void;
  deleteSelectedPath: () => void;
  deleteSelectedMarker: () => void;
  cancelTransientInteraction: () => void;
}

interface MapCanvasProps {
  camera: Camera;
  tool: MapTool;
  biome: Biome;
  brushWidth: number;
  strokes: readonly BiomeStroke[];
  paths: readonly Path[];
  markers: readonly Marker[];
  pendingPathIds: ReadonlySet<string>;
  pendingMarkerIds: ReadonlySet<string>;
  pathOpacity: number;
  protectEnabled: boolean;
  pathGeometryType: PathGeometryType;
  armedMarkerType: string | null;
  selectedPathId: string | null;
  selectedMarkerId: string | null;
  markerPreview: Marker | null;
  gridVisible: boolean;
  mapId: string | null;
  interactionEnabled: boolean;
  onCameraChange: (camera: Camera) => void;
  onCursorWorldChange: (point: WorldPoint) => void;
  onStrokeComplete: (gesture: CompletedBrushGesture) => void;
  onPathComplete: (gesture: CompletedPathGesture) => void;
  onPathUpdate: (path: Path) => void;
  onPathDelete: (pathId: string) => void;
  onPathSelectionChange: (pathId: string | null) => void;
  onMarkerComplete: (gesture: CompletedMarkerGesture) => void;
  onMarkerUpdate: (marker: Marker) => void;
  onMarkerDelete: (markerId: string) => void;
  onMarkerSelectionChange: (markerId: string | null) => void;
  onMarkerPlacementDisarm: () => void;
  onToolChange: (tool: MapTool) => void;
}

interface PanState {
  pointerId: number;
  screenPoint: ScreenPoint;
}

interface DrawingState {
  pointerId: number;
  mode: 'paint' | 'erase';
  biome: Biome | null;
  brushWidth: number;
  points: WorldPoint[];
  latestPoint: WorldPoint;
}

interface PathDrawingState {
  pointerId: number;
  geometryType: PathGeometryType;
  strokeWidth: number;
  start: WorldPoint;
  points: WorldPoint[];
  latestPoint: WorldPoint;
}

interface PathEditState {
  pointerId: number;
  path: Path;
  pointIndex: number;
}

interface MarkerDragState {
  pointerId: number;
  marker: Marker;
  moved: boolean;
  wasSelected: boolean;
}

interface MarkerPlacementState {
  pointerId: number;
  screenPoint: ScreenPoint;
  point: WorldPoint;
  markerType: string;
  moved: boolean;
}

type PointerGestureKind =
  | 'pan'
  | 'biome-draw'
  | 'erase'
  | 'path-draw'
  | 'path-edit'
  | 'marker-drag'
  | 'marker-place';

interface ActivePointerGesture {
  pointerId: number;
  kind: PointerGestureKind;
}

interface PositionedEvent {
  currentTarget: HTMLDivElement;
  clientX: number;
  clientY: number;
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  {
    camera,
    tool,
    biome,
    brushWidth,
    strokes,
    paths,
    markers,
    pendingPathIds,
    pendingMarkerIds,
    pathOpacity,
    protectEnabled,
    pathGeometryType,
    armedMarkerType,
    selectedPathId,
    selectedMarkerId,
    markerPreview,
    gridVisible,
    mapId,
    interactionEnabled,
    onCameraChange,
    onCursorWorldChange,
    onStrokeComplete,
    onPathComplete,
    onPathUpdate,
    onPathDelete,
    onPathSelectionChange,
    onMarkerComplete,
    onMarkerUpdate,
    onMarkerDelete,
    onMarkerSelectionChange,
    onMarkerPlacementDisarm,
    onToolChange,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiMapRenderer | null>(null);
  const cameraRef = useRef(camera);
  const strokesRef = useRef(strokes);
  const pathsRef = useRef(paths);
  const markersRef = useRef(markers);
  const pendingPathIdsRef = useRef(pendingPathIds);
  const pendingMarkerIdsRef = useRef(pendingMarkerIds);
  // Interaction becomes enabled only after the authoritative map state loads.
  const terrainHydratedRef = useRef(interactionEnabled);
  const toolRef = useRef(tool);
  const pathGeometryTypeRef = useRef(pathGeometryType);
  const selectedPathIdRef = useRef<string | null>(selectedPathId);
  const selectedMarkerIdRef = useRef<string | null>(selectedMarkerId);
  const armedMarkerTypeRef = useRef<string | null>(armedMarkerType);
  const postPlacementMarkerSelectRef = useRef(false);
  const pathCreationArmedRef = useRef(tool === 'path');
  const previousToolRef = useRef(tool);
  const markerPreviewRef = useRef<Marker | null>(markerPreview);
  const pathOpacityRef = useRef(pathOpacity);
  const protectEnabledRef = useRef(protectEnabled);
  const biomeRef = useRef(biome);
  const brushWidthRef = useRef(brushWidth);
  const gridVisibleRef = useRef(gridVisible);
  const panStateRef = useRef<PanState | null>(null);
  const drawingStateRef = useRef<DrawingState | null>(null);
  const pathDrawingStateRef = useRef<PathDrawingState | null>(null);
  const pathEditStateRef = useRef<PathEditState | null>(null);
  const markerDragStateRef = useRef<MarkerDragState | null>(null);
  const markerPlacementStateRef = useRef<MarkerPlacementState | null>(null);
  const activePointerGestureRef = useRef<ActivePointerGesture | null>(null);
  const pointerWorldRef = useRef<WorldPoint | null>(null);
  // This must be synchronous: pointerdown cannot safely wait for React state.
  const spaceHeldRef = useRef(false);

  const commitCamera = useCallback(
    (nextCamera: Camera) => {
      cameraRef.current = nextCamera;
      rendererRef.current?.setCamera(nextCamera);
      onCameraChange(nextCamera);
    },
    [onCameraChange],
  );

  const updateBrushCursor = useCallback(
    (point: WorldPoint | null, visible = true) => {
      const currentTool = toolRef.current;
      if (!isBrushTool(currentTool) || point === null) {
        rendererRef.current?.setBrushCursor(null);
        return;
      }

      rendererRef.current?.setBrushCursor({
        visible,
        point,
        brushWidth: brushWidthRef.current,
        color: currentTool === 'eraser' ? 0x6c665d : biomeColor(biomeRef.current),
      });
    },
    [],
  );

  const clearMarkerPlacement = useCallback(() => {
    armedMarkerTypeRef.current = null;
    markerPlacementStateRef.current = null;
    rendererRef.current?.setMarkerPlacementPreview(null);
    onMarkerPlacementDisarm();
  }, [onMarkerPlacementDisarm]);

  const cancelActivePointerGesture = useCallback(() => {
    activePointerGestureRef.current = null;
    panStateRef.current = null;
    drawingStateRef.current = null;
    pathDrawingStateRef.current = null;
    pathEditStateRef.current = null;
    markerDragStateRef.current = null;
    markerPlacementStateRef.current = null;
    rendererRef.current?.setTerrainPreview(null);
    rendererRef.current?.setPathPreview(null);
    rendererRef.current?.setPathEditPreview(null);
    rendererRef.current?.setMarkerEditPreview(null);
    rendererRef.current?.setMarkerPlacementPreview(null);
  }, []);

  const cancelTransientInteraction = useCallback(() => {
    cancelActivePointerGesture();
    if (armedMarkerTypeRef.current !== null) {
      clearMarkerPlacement();
    }
  }, [cancelActivePointerGesture, clearMarkerPlacement]);

  const updateMarkerPlacementPreview = useCallback((point: WorldPoint | null) => {
    const markerType = armedMarkerTypeRef.current;
    if (toolRef.current !== 'marker' || markerType === null || point === null) {
      rendererRef.current?.setMarkerPlacementPreview(null);
      return;
    }
    const preview: MarkerPlacementPreview = {
      markerType,
      point,
      directionDegrees: markerType === 'vegvisir' ? 0 : null,
    };
    rendererRef.current?.setMarkerPlacementPreview(preview);
  }, []);

  const worldPointFromScreen = useCallback((screenPoint: ScreenPoint): WorldPoint | null => {
    const host = hostRef.current;
    if (host === null || host.clientWidth <= 0 || host.clientHeight <= 0) {
      return null;
    }

    return screenToWorld(screenPoint, cameraRef.current, {
      width: host.clientWidth,
      height: host.clientHeight,
    });
  }, []);

  const reportPointerWorld = useCallback(
    (screenPoint: ScreenPoint): WorldPoint | null => {
      const point = worldPointFromScreen(screenPoint);
      if (point !== null) {
        pointerWorldRef.current = point;
        onCursorWorldChange(point);
        updateBrushCursor(point);
        updateMarkerPlacementPreview(point);
      }
      return point;
    },
    [onCursorWorldChange, updateBrushCursor, updateMarkerPlacementPreview, worldPointFromScreen],
  );

  useEffect(() => {
    cameraRef.current = camera;
    rendererRef.current?.setCamera(camera);
  }, [camera]);

  useEffect(() => {
    strokesRef.current = strokes;
    terrainHydratedRef.current = interactionEnabled;
    rendererRef.current?.setTerrainStrokes(strokes);
    if (interactionEnabled) {
      rendererRef.current?.requestInitialTerrainRedraw();
    }
  }, [strokes, interactionEnabled]);

  useEffect(() => {
    pathsRef.current = paths;
    rendererRef.current?.setPaths(paths);
    const selectedStillExists =
      selectedPathIdRef.current !== null && paths.some((path) => path.id === selectedPathIdRef.current);
    if (!selectedStillExists && selectedPathIdRef.current !== null) {
      selectedPathIdRef.current = null;
      onPathSelectionChange(null);
    }
    if (pathEditStateRef.current === null) {
      rendererRef.current?.setPathEditPreview(null);
    }
  }, [onPathSelectionChange, paths]);

  useEffect(() => {
    markersRef.current = markers;
    rendererRef.current?.setMarkers(markers);
    const selectedStillExists =
      selectedMarkerIdRef.current !== null && markers.some((marker) => marker.id === selectedMarkerIdRef.current);
    if (!selectedStillExists && selectedMarkerIdRef.current !== null) {
      selectedMarkerIdRef.current = null;
      onMarkerSelectionChange(null);
    }
    if (markerDragStateRef.current === null) {
      rendererRef.current?.setMarkerEditPreview(null);
    }
  }, [markers, onMarkerSelectionChange]);

  useEffect(() => {
    pendingPathIdsRef.current = pendingPathIds;
    pendingMarkerIdsRef.current = pendingMarkerIds;
  }, [pendingMarkerIds, pendingPathIds]);

  useEffect(() => {
    selectedPathIdRef.current = selectedPathId;
    rendererRef.current?.setSelectedPath(selectedPathId);
  }, [selectedPathId]);

  useEffect(() => {
    selectedMarkerIdRef.current = selectedMarkerId;
    rendererRef.current?.setSelectedMarker(selectedMarkerId);
  }, [selectedMarkerId]);

  useEffect(() => {
    markerPreviewRef.current = markerPreview;
    rendererRef.current?.setMarkerEditPreview(markerPreview);
  }, [markerPreview]);

  useEffect(() => {
    // Map switches replace the authoritative object set; no transient gesture
    // or edit preview is allowed to carry into the next map.
    drawingStateRef.current = null;
    pathDrawingStateRef.current = null;
    pathEditStateRef.current = null;
    markerDragStateRef.current = null;
    markerPlacementStateRef.current = null;
    activePointerGestureRef.current = null;
    postPlacementMarkerSelectRef.current = false;
    rendererRef.current?.setTerrainPreview(null);
    rendererRef.current?.setPathPreview(null);
    rendererRef.current?.setPathEditPreview(null);
    rendererRef.current?.setMarkerEditPreview(null);
    rendererRef.current?.setMarkerPlacementPreview(null);
  }, [mapId]);

  useEffect(() => {
    pathOpacityRef.current = pathOpacity;
    rendererRef.current?.setPathsOpacity(pathOpacity);
  }, [pathOpacity]);

  useEffect(() => {
    protectEnabledRef.current = protectEnabled;
  }, [protectEnabled]);

  useEffect(() => {
    gridVisibleRef.current = gridVisible;
    rendererRef.current?.setGridVisible(gridVisible);
  }, [gridVisible]);

  useEffect(() => {
    toolRef.current = tool;
    pathGeometryTypeRef.current = pathGeometryType;
    armedMarkerTypeRef.current = armedMarkerType;
    if (tool !== previousToolRef.current) {
      pathCreationArmedRef.current = tool === 'path';
      previousToolRef.current = tool;
    }
    if (tool !== 'select') {
      postPlacementMarkerSelectRef.current = false;
    }
    if (tool !== 'path') {
      pathCreationArmedRef.current = false;
    }
    if (tool !== 'marker' || armedMarkerType === null) {
      markerPlacementStateRef.current = null;
    }
    biomeRef.current = biome;
    brushWidthRef.current = brushWidth;
    updateBrushCursor(pointerWorldRef.current);
    updateMarkerPlacementPreview(pointerWorldRef.current);
  }, [armedMarkerType, biome, brushWidth, pathGeometryType, tool, updateBrushCursor, updateMarkerPlacementPreview]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }

    const renderer = new PixiMapRenderer();
    let disposed = false;

    void renderer.initialize(host).then(() => {
      if (disposed) {
        renderer.destroy();
        return;
      }

      rendererRef.current = renderer;
      renderer.setCamera(cameraRef.current);
      renderer.setTerrainStrokes(strokesRef.current);
      renderer.setPaths(pathsRef.current);
      renderer.setMarkers(markersRef.current);
      renderer.setPathsOpacity(pathOpacityRef.current);
      renderer.setSelectedPath(selectedPathIdRef.current);
      renderer.setSelectedMarker(selectedMarkerIdRef.current);
      renderer.setMarkerEditPreview(markerPreviewRef.current);
      updateMarkerPlacementPreview(pointerWorldRef.current);
      if (terrainHydratedRef.current) {
        renderer.requestInitialTerrainRedraw();
      }
      renderer.setGridVisible(gridVisibleRef.current);
      updateBrushCursor(pointerWorldRef.current);
    });

    return () => {
      disposed = true;
      if (rendererRef.current === renderer) {
        rendererRef.current = null;
      }
      renderer.destroy();
    };
  }, [updateMarkerPlacementPreview]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        spaceHeldRef.current = true;
        const activeGesture = activePointerGestureRef.current;
        if (
          activeGesture?.kind === 'biome-draw' ||
          activeGesture?.kind === 'erase' ||
          activeGesture?.kind === 'path-draw' ||
          activeGesture?.kind === 'marker-place'
        ) {
          // A late Space press means the user intended to navigate. Never
          // persist the partial draw as a long accidental gesture.
          cancelActivePointerGesture();
        }
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape' && !isTypingTarget(event.target)) {
        if (armedMarkerTypeRef.current !== null) {
          event.preventDefault();
          clearMarkerPlacement();
          return;
        }
        if (selectedMarkerIdRef.current !== null) {
          event.preventDefault();
          postPlacementMarkerSelectRef.current = false;
          selectedMarkerIdRef.current = null;
          rendererRef.current?.setSelectedMarker(null);
          onMarkerSelectionChange(null);
          return;
        }
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !isTypingTarget(event.target)
      ) {
        const markerId = selectedMarkerIdRef.current;
        const marker = markerId === null ? undefined : markersRef.current.find((candidate) => candidate.id === markerId);
        if (marker !== undefined && marker.objectVersion > 0 && !pendingMarkerIdsRef.current.has(marker.id)) {
          event.preventDefault();
          onMarkerSelectionChange(null);
          onMarkerDelete(marker.id);
          return;
        }
        const pathId = selectedPathIdRef.current;
        const path = pathId === null ? undefined : pathsRef.current.find((candidate) => candidate.id === pathId);
        if (path !== undefined && path.objectVersion > 0 && !pendingPathIdsRef.current.has(path.id)) {
          event.preventDefault();
          onPathSelectionChange(null);
          onPathDelete(path.id);
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceHeldRef.current = false;
      }
    };
    const onWindowBlur = () => {
      spaceHeldRef.current = false;
      cancelActivePointerGesture();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        onWindowBlur();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [cancelActivePointerGesture, clearMarkerPlacement, onMarkerDelete, onMarkerSelectionChange, onPathDelete, onPathSelectionChange]);

  useImperativeHandle(
    ref,
    () => ({
      resetView: () => commitCamera({ ...DEFAULT_CAMERA }),
      zoomToOne: () => commitCamera({ ...cameraRef.current, zoom: DEFAULT_ZOOM }),
      deleteSelectedPath: () => {
        const pathId = selectedPathIdRef.current;
        const selected = pathId === null ? undefined : pathsRef.current.find((path) => path.id === pathId);
        if (selected !== undefined && selected.objectVersion > 0 && !pendingPathIdsRef.current.has(selected.id)) {
          onPathSelectionChange(null);
          onPathDelete(selected.id);
        }
      },
      deleteSelectedMarker: () => {
        const markerId = selectedMarkerIdRef.current;
        const selected = markerId === null ? undefined : markersRef.current.find((marker) => marker.id === markerId);
        if (selected !== undefined && selected.objectVersion > 0 && !pendingMarkerIdsRef.current.has(selected.id)) {
          onMarkerSelectionChange(null);
          onMarkerDelete(selected.id);
        }
      },
      cancelTransientInteraction,
    }),
    [cancelTransientInteraction, commitCamera, onMarkerDelete, onMarkerSelectionChange, onPathDelete, onPathSelectionChange],
  );

  const screenPointFromPointer = (event: PositionedEvent): ScreenPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const previewDrawing = (drawing: DrawingState): void => {
    const points =
      drawing.points.at(-1)?.[0] === drawing.latestPoint[0] &&
      drawing.points.at(-1)?.[1] === drawing.latestPoint[1]
        ? drawing.points
        : [...drawing.points, drawing.latestPoint];
    const preview: TerrainPreview = {
      mode: drawing.mode,
      biome: drawing.biome,
      brushWidth: drawing.brushWidth,
      points,
    };
    rendererRef.current?.setTerrainPreview(preview);
  };

  const selectPath = (pathId: string | null): void => {
    selectedPathIdRef.current = pathId;
    rendererRef.current?.setSelectedPath(pathId);
    if (pathId !== null && selectedMarkerIdRef.current !== null) {
      selectedMarkerIdRef.current = null;
      rendererRef.current?.setSelectedMarker(null);
      onMarkerSelectionChange(null);
    }
    onPathSelectionChange(pathId);
  };

  const selectMarker = (markerId: string | null): void => {
    selectedMarkerIdRef.current = markerId;
    rendererRef.current?.setSelectedMarker(markerId);
    if (markerId !== null && selectedPathIdRef.current !== null) {
      selectedPathIdRef.current = null;
      rendererRef.current?.setSelectedPath(null);
      onPathSelectionChange(null);
    }
    onMarkerSelectionChange(markerId);
  };

  const previewPathDrawing = (drawing: PathDrawingState): void => {
    const end = drawing.latestPoint;
    const sampledPoints =
      drawing.points.at(-1)?.[0] === end[0] && drawing.points.at(-1)?.[1] === end[1]
        ? drawing.points
        : [...drawing.points, end];
    const points =
      drawing.geometryType === 'freehand'
        ? sampledPoints
        : drawing.geometryType === 'straight'
          ? [drawing.start, end]
          : [drawing.start, midpoint(drawing.start, end), end];
    const preview: PathPreview = {
      geometryType: drawing.geometryType,
      strokeWidth: drawing.strokeWidth,
      points,
    };
    rendererRef.current?.setPathPreview(preview);
  };

  const selectedPath = (): Path | null => {
    const pathId = selectedPathIdRef.current;
    return pathId === null ? null : pathsRef.current.find((path) => path.id === pathId) ?? null;
  };

  const hitSelectedControlPoint = (path: Path, point: WorldPoint): number | null => {
    if (path.geometryType === 'freehand') {
      return null;
    }
    const tolerance = 11 / cameraRef.current.zoom;
    const toleranceSquared = tolerance * tolerance;
    let closestIndex: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < path.points.length; index += 1) {
      const candidate = path.points[index];
      const deltaX = point[0] - candidate[0];
      const deltaY = point[1] - candidate[1];
      const distance = deltaX * deltaX + deltaY * deltaY;
      if (distance <= toleranceSquared && distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    }
    return closestIndex;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactionEnabled) {
      return;
    }
    const screenPoint = screenPointFromPointer(event);
    const worldPoint = reportPointerWorld(screenPoint);
    const currentTool = toolRef.current;
    const panObjectHit =
      currentTool === 'pan' &&
      !protectEnabledRef.current &&
      worldPoint !== null &&
      (hitTestMarker(markersRef.current, worldPoint, cameraRef.current.zoom) !== null ||
        hitTestPath(pathsRef.current, worldPoint, 12 / cameraRef.current.zoom) !== null);
    if (shouldClearPanSelection({
      tool: currentTool,
      protectEnabled: protectEnabledRef.current,
      button: event.button,
      spaceHeld: spaceHeldRef.current,
      objectHit: panObjectHit,
    })) {
      selectMarker(null);
      selectPath(null);
    }
    // Navigation always wins before any tool can capture a drawing gesture.
    const initialGesture = initialPointerGesture({
      button: event.button,
      spaceHeld: spaceHeldRef.current,
      tool: currentTool,
      markerPlacementArmed: armedMarkerTypeRef.current !== null,
      pathCreationArmed: pathCreationArmedRef.current,
      panObjectInteraction: panObjectHit,
    });

    if (initialGesture === 'pan') {
      event.preventDefault();
      panStateRef.current = { pointerId: event.pointerId, screenPoint };
      activePointerGestureRef.current = { pointerId: event.pointerId, kind: 'pan' };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button !== 0 || worldPoint === null) {
      return;
    }

    const postPlacementSelect = currentTool === 'select' && postPlacementMarkerSelectRef.current;

    if (currentTool === 'marker') {
      event.preventDefault();
      const hitMarker = hitTestMarker(markersRef.current, worldPoint, cameraRef.current.zoom);
      if (hitMarker !== null) {
        // In Marker mode a normal click is marker interaction, never a new
        // placement and never an accidental deselection.
        selectMarker(hitMarker.id);
        return;
      }
      const markerType = armedMarkerTypeRef.current;
      if (markerType === null) {
        selectMarker(null);
        onToolChange('pan');
        return;
      }
      markerPlacementStateRef.current = {
        pointerId: event.pointerId,
        screenPoint,
        point: worldPoint,
        markerType,
        moved: false,
      };
      activePointerGestureRef.current = { pointerId: event.pointerId, kind: 'marker-place' };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const interactivePan = currentTool === 'pan' && !protectEnabledRef.current && initialGesture === 'select';

    if (currentTool === 'select' || interactivePan) {
      const hitMarker = hitTestMarker(markersRef.current, worldPoint, cameraRef.current.zoom);
      if (hitMarker !== null) {
        event.preventDefault();
        const wasSelected = selectedMarkerIdRef.current === hitMarker.id;
        selectMarker(hitMarker.id);
        if (hitMarker.objectVersion > 0 && !pendingMarkerIdsRef.current.has(hitMarker.id)) {
          markerDragStateRef.current = {
            pointerId: event.pointerId,
            marker: hitMarker,
            moved: false,
            wasSelected,
          };
          activePointerGestureRef.current = { pointerId: event.pointerId, kind: 'marker-drag' };
          event.currentTarget.setPointerCapture(event.pointerId);
        } else if (wasSelected && !postPlacementMarkerSelectRef.current) {
          selectMarker(null);
        }
        return;
      }
      // A path may still be hit below this point. Clear marker selection now,
      // then the path branch below may replace it.
      selectMarker(null);
    }

    if (currentTool === 'path' || currentTool === 'select' || interactivePan) {
      const currentSelected = selectedPath();
      const controlIndex =
        currentSelected !== null &&
        currentSelected.objectVersion > 0 &&
        !pendingPathIdsRef.current.has(currentSelected.id)
          ? hitSelectedControlPoint(currentSelected, worldPoint)
          : null;
      if (controlIndex !== null) {
        event.preventDefault();
        pathEditStateRef.current = {
          pointerId: event.pointerId,
          path: currentSelected!,
          pointIndex: controlIndex,
        };
        activePointerGestureRef.current = { pointerId: event.pointerId, kind: 'path-edit' };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      const hit = hitTestPath(pathsRef.current, worldPoint, 12 / cameraRef.current.zoom);
      if (hit !== null) {
        event.preventDefault();
        selectPath(hit.id);
        return;
      }
      if (currentTool === 'select' || interactivePan || !pathCreationArmedRef.current) {
        event.preventDefault();
        selectPath(null);
        if (currentTool === 'path') {
          toolRef.current = 'pan';
          onToolChange('pan');
        } else if (postPlacementSelect) {
          postPlacementMarkerSelectRef.current = false;
          toolRef.current = 'pan';
          onToolChange('pan');
        }
        return;
      }

      event.preventDefault();
      const drawing: PathDrawingState = {
        pointerId: event.pointerId,
        geometryType: pathGeometryTypeRef.current,
        strokeWidth: DEFAULT_PATH_STROKE_WIDTH,
        start: worldPoint,
        points: [worldPoint],
        latestPoint: worldPoint,
      };
      pathDrawingStateRef.current = drawing;
      activePointerGestureRef.current = { pointerId: event.pointerId, kind: 'path-draw' };
      event.currentTarget.setPointerCapture(event.pointerId);
      previewPathDrawing(drawing);
      return;
    }

    if (!isBrushTool(currentTool)) {
      return;
    }

    event.preventDefault();
    const drawing: DrawingState = {
      pointerId: event.pointerId,
      mode: currentTool === 'eraser' ? 'erase' : 'paint',
      biome: currentTool === 'eraser' ? null : biomeRef.current,
      brushWidth: brushWidthRef.current,
      points: [worldPoint],
      latestPoint: worldPoint,
    };
    drawingStateRef.current = drawing;
    activePointerGestureRef.current = {
      pointerId: event.pointerId,
      kind: drawing.mode === 'erase' ? 'erase' : 'biome-draw',
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDrawing(drawing);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactionEnabled) {
      return;
    }
    const screenPoint = screenPointFromPointer(event);
    const activeGesture = activePointerGestureRef.current;
    const panState = panStateRef.current;

    if (activeGesture?.kind === 'pan' && panState?.pointerId === event.pointerId) {
      event.preventDefault();
      commitCamera(
        panCameraByScreenDelta(cameraRef.current, {
          x: screenPoint.x - panState.screenPoint.x,
          y: screenPoint.y - panState.screenPoint.y,
        }),
      );
      panState.screenPoint = screenPoint;
    }

    const worldPoint = reportPointerWorld(screenPoint);
    const drawing = drawingStateRef.current;
    if (
      (activeGesture?.kind === 'biome-draw' || activeGesture?.kind === 'erase') &&
      drawing?.pointerId === event.pointerId &&
      worldPoint !== null
    ) {
      event.preventDefault();
      drawing.latestPoint = worldPoint;
      if (shouldSamplePoint(drawing.points, worldPoint, strokeSampleDistance(drawing.brushWidth))) {
        drawing.points.push(worldPoint);
      }
      previewDrawing(drawing);
    }

    const pathDrawing = pathDrawingStateRef.current;
    if (activeGesture?.kind === 'path-draw' && pathDrawing?.pointerId === event.pointerId && worldPoint !== null) {
      event.preventDefault();
      pathDrawing.latestPoint = worldPoint;
      if (
        pathDrawing.geometryType === 'freehand' &&
        shouldSamplePoint(pathDrawing.points, worldPoint, pathSampleDistance(pathDrawing.strokeWidth))
      ) {
        pathDrawing.points.push(worldPoint);
      }
      previewPathDrawing(pathDrawing);
    }

    const pathEdit = pathEditStateRef.current;
    if (activeGesture?.kind === 'path-edit' && pathEdit?.pointerId === event.pointerId && worldPoint !== null) {
      event.preventDefault();
      const draft = replacePathControlPoint(pathEdit.path, pathEdit.pointIndex, worldPoint);
      pathEdit.path = draft;
      rendererRef.current?.setPathEditPreview(draft);
    }

    const markerDrag = markerDragStateRef.current;
    if (activeGesture?.kind === 'marker-drag' && markerDrag?.pointerId === event.pointerId && worldPoint !== null) {
      event.preventDefault();
      const draft = movedMarker(markerDrag.marker, worldPoint);
      if (draft.x !== markerDrag.marker.x || draft.y !== markerDrag.marker.y) {
        markerDrag.moved = true;
      }
      markerDrag.marker = draft;
      rendererRef.current?.setMarkerEditPreview(draft);
    }

    const markerPlacement = markerPlacementStateRef.current;
    if (activeGesture?.kind === 'marker-place' && markerPlacement?.pointerId === event.pointerId && worldPoint !== null) {
      const screenDistance = Math.hypot(
        screenPoint.x - markerPlacement.screenPoint.x,
        screenPoint.y - markerPlacement.screenPoint.y,
      );
      markerPlacement.moved ||= screenDistance > 4;
      markerPlacement.point = worldPoint;
    }
  };

  const finishDrawing = (event: PointerEvent<HTMLDivElement>) => {
    const drawing = drawingStateRef.current;
    if (drawing?.pointerId !== event.pointerId) {
      return;
    }

    const screenPoint = screenPointFromPointer(event);
    const finalPoint = reportPointerWorld(screenPoint) ?? drawing.latestPoint;
    if (!pointsMatch(drawing.points.at(-1), finalPoint)) {
      drawing.points.push(finalPoint);
    }
    const points = simplifyStrokePoints(drawing.points, Math.max(0.5, drawing.brushWidth * 0.025));
    drawingStateRef.current = null;
    rendererRef.current?.setTerrainPreview(null);
    onStrokeComplete({
      mode: drawing.mode,
      biome: drawing.biome,
      brushWidth: drawing.brushWidth,
      points,
    });
  };

  const finishPathDrawing = (event: PointerEvent<HTMLDivElement>) => {
    const drawing = pathDrawingStateRef.current;
    if (drawing?.pointerId !== event.pointerId) {
      return;
    }
    const finalPoint = reportPointerWorld(screenPointFromPointer(event)) ?? drawing.latestPoint;
    if (drawing.geometryType === 'freehand' && !pointsMatch(drawing.points.at(-1), finalPoint)) {
      drawing.points.push(finalPoint);
    }
    const points =
      drawing.geometryType === 'freehand'
        ? simplifyStrokePoints(drawing.points, Math.max(0.5, drawing.strokeWidth * 0.08))
        : drawing.geometryType === 'straight'
          ? [drawing.start, finalPoint]
          : [drawing.start, midpoint(drawing.start, finalPoint), finalPoint];
    pathDrawingStateRef.current = null;
    rendererRef.current?.setPathPreview(null);
    if (!hasMeaningfulPathLength(points)) {
      return;
    }

    const id = crypto.randomUUID();
    pathCreationArmedRef.current = false;
    if (drawing.geometryType === 'freehand') {
      // Freehand has no useful control-point editing, so it exits directly.
      selectPath(null);
      toolRef.current = 'pan';
      onToolChange('pan');
    } else {
      // Straight and curve remain selected for immediate endpoint/control
      // editing, but creation itself is disarmed.
      selectPath(id);
    }
    onPathComplete({
      id,
      geometryType: drawing.geometryType,
      strokeWidth: drawing.strokeWidth,
      points,
    });
  };

  const finishPathEdit = (event: PointerEvent<HTMLDivElement>) => {
    const editing = pathEditStateRef.current;
    if (editing?.pointerId !== event.pointerId) {
      return;
    }
    pathEditStateRef.current = null;
    // Keep this direct preview until the optimistic React state replaces it.
    rendererRef.current?.setPathEditPreview(editing.path);
    onPathUpdate(editing.path);
  };

  const finishMarkerDrag = (event: PointerEvent<HTMLDivElement>) => {
    const dragging = markerDragStateRef.current;
    if (dragging?.pointerId !== event.pointerId) {
      return;
    }
    markerDragStateRef.current = null;
    if (!dragging.moved) {
      rendererRef.current?.setMarkerEditPreview(null);
      if (dragging.wasSelected && !postPlacementMarkerSelectRef.current) {
        selectMarker(null);
      }
      return;
    }
    // Preserve the direct display until the versioned optimistic update lands.
    rendererRef.current?.setMarkerEditPreview(dragging.marker);
    onMarkerUpdate(dragging.marker);
  };

  const finishMarkerPlacement = (event: PointerEvent<HTMLDivElement>) => {
    const placement = markerPlacementStateRef.current;
    if (placement?.pointerId !== event.pointerId) {
      return;
    }
    markerPlacementStateRef.current = null;
    if (placement.moved) {
      return;
    }
    const finalPoint = reportPointerWorld(screenPointFromPointer(event)) ?? placement.point;
    // Placement is single-shot. Disarm before issuing the optimistic create
    // so a later click cannot produce a second marker while this save is pending.
    clearMarkerPlacement();
    const id = crypto.randomUUID();
    // Keep the newly placed marker selected so its caption/size/direction can
    // be edited immediately. Select is entered automatically; a later
    // empty-map click exits to Pan.
    selectMarker(id);
    postPlacementMarkerSelectRef.current = true;
    toolRef.current = 'select';
    onToolChange('select');
    onMarkerComplete({
      id,
      markerType: placement.markerType,
      x: finalPoint[0],
      y: finalPoint[1],
      directionDegrees: placement.markerType === 'vegvisir' ? 0 : null,
    });
  };

  const endPointerInteraction = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const activeGesture = activePointerGestureRef.current;
    if (activeGesture?.pointerId !== event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if ((activeGesture.kind === 'biome-draw' || activeGesture.kind === 'erase') && drawingStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        drawingStateRef.current = null;
        rendererRef.current?.setTerrainPreview(null);
      } else {
        finishDrawing(event);
      }
    }

    if (activeGesture.kind === 'path-draw' && pathDrawingStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        pathDrawingStateRef.current = null;
        rendererRef.current?.setPathPreview(null);
      } else {
        finishPathDrawing(event);
      }
    }

    if (activeGesture.kind === 'path-edit' && pathEditStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        pathEditStateRef.current = null;
        rendererRef.current?.setPathEditPreview(null);
      } else {
        finishPathEdit(event);
      }
    }

    if (activeGesture.kind === 'marker-drag' && markerDragStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        markerDragStateRef.current = null;
        rendererRef.current?.setMarkerEditPreview(null);
      } else {
        finishMarkerDrag(event);
      }
    }

    if (activeGesture.kind === 'marker-place' && markerPlacementStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        markerPlacementStateRef.current = null;
        rendererRef.current?.setMarkerPlacementPreview(null);
      } else {
        finishMarkerPlacement(event);
      }
    }

    if (activeGesture.kind === 'pan' && panStateRef.current?.pointerId === event.pointerId) {
      panStateRef.current = null;
    }
    activePointerGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!interactionEnabled) {
      return;
    }
    event.preventDefault();
    const screenPoint = screenPointFromPointer(event);
    const viewportHeight = event.currentTarget.clientHeight;
    const pixelDelta =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * viewportHeight
          : event.deltaY;

    if (!Number.isFinite(pixelDelta)) {
      return;
    }

    const zoomFactor = Math.exp(-pixelDelta * 0.0015);
    commitCamera(
      zoomAtScreenPoint(
        cameraRef.current,
        screenPoint,
        { width: event.currentTarget.clientWidth, height: viewportHeight },
        cameraRef.current.zoom * zoomFactor,
      ),
    );
    reportPointerWorld(screenPoint);
  };

  return (
    <div
      ref={hostRef}
      className={`map-canvas-host map-canvas-host--${tool}`}
      onContextMenu={(event) => event.preventDefault()}
      onPointerCancel={(event) => endPointerInteraction(event, true)}
      onLostPointerCapture={(event) => endPointerInteraction(event, true)}
      onPointerDown={handlePointerDown}
      onPointerEnter={(event) => reportPointerWorld(screenPointFromPointer(event))}
      onPointerLeave={() => {
        if (drawingStateRef.current === null && pathDrawingStateRef.current === null) {
          updateBrushCursor(null);
        }
        if (markerDragStateRef.current === null && markerPlacementStateRef.current === null) {
          updateMarkerPlacementPreview(null);
        }
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endPointerInteraction(event, false)}
      onWheel={handleWheel}
      role="application"
      aria-disabled={!interactionEnabled}
      aria-label={`Infinite map canvas. Zoom range ${MIN_ZOOM * 100}% to ${MAX_ZOOM * 100}%.`}
    />
  );
});

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function pointsMatch(left: WorldPoint | undefined, right: WorldPoint): boolean {
  return left !== undefined && left[0] === right[0] && left[1] === right[1];
}

function hasMeaningfulPathLength(points: readonly WorldPoint[]): boolean {
  if (points.length < 2) {
    return false;
  }
  return points.some((point, index) => {
    const previous = points[index - 1];
    return previous !== undefined && Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.25;
  });
}
