import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import type { Biome, BiomeStroke, Path, PathGeometryType, WorldPoint } from '../../../../shared/domain';
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
import type { MapTool } from '../../state/mapTool';
import { isBrushTool } from '../../state/mapTool';
import { PixiMapRenderer, type PathPreview, type TerrainPreview } from './PixiMapRenderer';

export interface MapCanvasHandle {
  resetView: () => void;
  zoomToOne: () => void;
  deleteSelectedPath: () => void;
}

interface MapCanvasProps {
  camera: Camera;
  tool: MapTool;
  biome: Biome;
  brushWidth: number;
  strokes: readonly BiomeStroke[];
  paths: readonly Path[];
  pathsVisible: boolean;
  pathGeometryType: PathGeometryType;
  selectedPathId: string | null;
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
    pathsVisible,
    pathGeometryType,
    selectedPathId,
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
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiMapRenderer | null>(null);
  const cameraRef = useRef(camera);
  const strokesRef = useRef(strokes);
  const pathsRef = useRef(paths);
  // Interaction becomes enabled only after the authoritative map state loads.
  const terrainHydratedRef = useRef(interactionEnabled);
  const toolRef = useRef(tool);
  const pathGeometryTypeRef = useRef(pathGeometryType);
  const selectedPathIdRef = useRef<string | null>(selectedPathId);
  const pathsVisibleRef = useRef(pathsVisible);
  const biomeRef = useRef(biome);
  const brushWidthRef = useRef(brushWidth);
  const gridVisibleRef = useRef(gridVisible);
  const panStateRef = useRef<PanState | null>(null);
  const drawingStateRef = useRef<DrawingState | null>(null);
  const pathDrawingStateRef = useRef<PathDrawingState | null>(null);
  const pathEditStateRef = useRef<PathEditState | null>(null);
  const pointerWorldRef = useRef<WorldPoint | null>(null);
  const spacePressedRef = useRef(false);

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
      }
      return point;
    },
    [onCursorWorldChange, updateBrushCursor, worldPointFromScreen],
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
    selectedPathIdRef.current = selectedPathId;
    rendererRef.current?.setSelectedPath(selectedPathId);
  }, [selectedPathId]);

  useEffect(() => {
    // Map switches replace the authoritative object set; no transient gesture
    // or edit preview is allowed to carry into the next map.
    drawingStateRef.current = null;
    pathDrawingStateRef.current = null;
    pathEditStateRef.current = null;
    rendererRef.current?.setTerrainPreview(null);
    rendererRef.current?.setPathPreview(null);
    rendererRef.current?.setPathEditPreview(null);
  }, [mapId]);

  useEffect(() => {
    pathsVisibleRef.current = pathsVisible;
    rendererRef.current?.setPathsVisible(pathsVisible);
  }, [pathsVisible]);

  useEffect(() => {
    gridVisibleRef.current = gridVisible;
    rendererRef.current?.setGridVisible(gridVisible);
  }, [gridVisible]);

  useEffect(() => {
    toolRef.current = tool;
    pathGeometryTypeRef.current = pathGeometryType;
    biomeRef.current = biome;
    brushWidthRef.current = brushWidth;
    updateBrushCursor(pointerWorldRef.current);
  }, [biome, brushWidth, pathGeometryType, tool, updateBrushCursor]);

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
      renderer.setPathsVisible(pathsVisibleRef.current);
      renderer.setSelectedPath(selectedPathIdRef.current);
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
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        spacePressedRef.current = true;
        event.preventDefault();
        return;
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !isTypingTarget(event.target) &&
        selectedPathIdRef.current !== null
      ) {
        const selected = pathsRef.current.find((path) => path.id === selectedPathIdRef.current);
        if (selected !== undefined && selected.objectVersion > 0) {
          event.preventDefault();
          onPathSelectionChange(null);
          onPathDelete(selected.id);
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spacePressedRef.current = false;
      }
    };
    const onWindowBlur = () => {
      spacePressedRef.current = false;
      panStateRef.current = null;
      drawingStateRef.current = null;
      pathDrawingStateRef.current = null;
      pathEditStateRef.current = null;
      rendererRef.current?.setTerrainPreview(null);
      rendererRef.current?.setPathPreview(null);
      rendererRef.current?.setPathEditPreview(null);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [onPathDelete, onPathSelectionChange]);

  useImperativeHandle(
    ref,
    () => ({
      resetView: () => commitCamera({ ...DEFAULT_CAMERA }),
      zoomToOne: () => commitCamera({ ...cameraRef.current, zoom: DEFAULT_ZOOM }),
      deleteSelectedPath: () => {
        const pathId = selectedPathIdRef.current;
        const selected = pathId === null ? undefined : pathsRef.current.find((path) => path.id === pathId);
        if (selected !== undefined && selected.objectVersion > 0) {
          onPathSelectionChange(null);
          onPathDelete(selected.id);
        }
      },
    }),
    [commitCamera, onPathDelete, onPathSelectionChange],
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
    onPathSelectionChange(pathId);
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
    const temporaryPan = event.button === 1 || (event.button === 0 && spacePressedRef.current);
    const selectedPan = event.button === 0 && tool === 'pan';

    if (temporaryPan || selectedPan) {
      event.preventDefault();
      panStateRef.current = { pointerId: event.pointerId, screenPoint };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button !== 0 || worldPoint === null) {
      return;
    }

    if (tool === 'path' || tool === 'select') {
      const currentSelected = selectedPath();
      const controlIndex =
        currentSelected !== null && currentSelected.objectVersion > 0
          ? hitSelectedControlPoint(currentSelected, worldPoint)
          : null;
      if (controlIndex !== null) {
        event.preventDefault();
        pathEditStateRef.current = {
          pointerId: event.pointerId,
          path: currentSelected!,
          pointIndex: controlIndex,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      const hit = pathsVisibleRef.current
        ? hitTestPath(pathsRef.current, worldPoint, 12 / cameraRef.current.zoom)
        : null;
      if (hit !== null) {
        event.preventDefault();
        selectPath(hit.id);
        return;
      }
      if (tool === 'select') {
        event.preventDefault();
        selectPath(null);
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
      event.currentTarget.setPointerCapture(event.pointerId);
      previewPathDrawing(drawing);
      return;
    }

    if (!isBrushTool(tool)) {
      return;
    }

    event.preventDefault();
    const drawing: DrawingState = {
      pointerId: event.pointerId,
      mode: tool === 'eraser' ? 'erase' : 'paint',
      biome: tool === 'eraser' ? null : biome,
      brushWidth,
      points: [worldPoint],
      latestPoint: worldPoint,
    };
    drawingStateRef.current = drawing;
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDrawing(drawing);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactionEnabled) {
      return;
    }
    const screenPoint = screenPointFromPointer(event);
    const panState = panStateRef.current;

    if (panState?.pointerId === event.pointerId) {
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
    if (drawing?.pointerId === event.pointerId && worldPoint !== null) {
      event.preventDefault();
      drawing.latestPoint = worldPoint;
      if (shouldSamplePoint(drawing.points, worldPoint, strokeSampleDistance(drawing.brushWidth))) {
        drawing.points.push(worldPoint);
      }
      previewDrawing(drawing);
    }

    const pathDrawing = pathDrawingStateRef.current;
    if (pathDrawing?.pointerId === event.pointerId && worldPoint !== null) {
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
    if (pathEdit?.pointerId === event.pointerId && worldPoint !== null) {
      event.preventDefault();
      const draft = replacePathControlPoint(pathEdit.path, pathEdit.pointIndex, worldPoint);
      pathEdit.path = draft;
      rendererRef.current?.setPathEditPreview(draft);
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
    selectPath(id);
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

  const endPointerInteraction = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (drawingStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        drawingStateRef.current = null;
        rendererRef.current?.setTerrainPreview(null);
      } else {
        finishDrawing(event);
      }
    }

    if (pathDrawingStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        pathDrawingStateRef.current = null;
        rendererRef.current?.setPathPreview(null);
      } else {
        finishPathDrawing(event);
      }
    }

    if (pathEditStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        pathEditStateRef.current = null;
        rendererRef.current?.setPathEditPreview(null);
      } else {
        finishPathEdit(event);
      }
    }

    if (panStateRef.current?.pointerId === event.pointerId) {
      panStateRef.current = null;
    }
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
      onPointerDown={handlePointerDown}
      onPointerEnter={(event) => reportPointerWorld(screenPointFromPointer(event))}
      onPointerLeave={() => {
        if (drawingStateRef.current === null && pathDrawingStateRef.current === null) {
          updateBrushCursor(null);
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
