import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import type { Biome, BiomeStroke, WorldPoint } from '../../../../shared/domain';
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
import type { MapTool } from '../../state/mapTool';
import { isBrushTool } from '../../state/mapTool';
import { PixiMapRenderer, type TerrainPreview } from './PixiMapRenderer';

export interface MapCanvasHandle {
  resetView: () => void;
  zoomToOne: () => void;
}

interface MapCanvasProps {
  camera: Camera;
  tool: MapTool;
  biome: Biome;
  brushWidth: number;
  strokes: readonly BiomeStroke[];
  gridVisible: boolean;
  interactionEnabled: boolean;
  onCameraChange: (camera: Camera) => void;
  onCursorWorldChange: (point: WorldPoint) => void;
  onStrokeComplete: (gesture: CompletedBrushGesture) => void;
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
    gridVisible,
    interactionEnabled,
    onCameraChange,
    onCursorWorldChange,
    onStrokeComplete,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixiMapRenderer | null>(null);
  const cameraRef = useRef(camera);
  const strokesRef = useRef(strokes);
  // Interaction becomes enabled only after the authoritative map state loads.
  const terrainHydratedRef = useRef(interactionEnabled);
  const toolRef = useRef(tool);
  const biomeRef = useRef(biome);
  const brushWidthRef = useRef(brushWidth);
  const gridVisibleRef = useRef(gridVisible);
  const panStateRef = useRef<PanState | null>(null);
  const drawingStateRef = useRef<DrawingState | null>(null);
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
    gridVisibleRef.current = gridVisible;
    rendererRef.current?.setGridVisible(gridVisible);
  }, [gridVisible]);

  useEffect(() => {
    toolRef.current = tool;
    biomeRef.current = biome;
    brushWidthRef.current = brushWidth;
    updateBrushCursor(pointerWorldRef.current);
  }, [biome, brushWidth, tool, updateBrushCursor]);

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
      rendererRef.current?.setTerrainPreview(null);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      resetView: () => commitCamera({ ...DEFAULT_CAMERA }),
      zoomToOne: () => commitCamera({ ...cameraRef.current, zoom: DEFAULT_ZOOM }),
    }),
    [commitCamera],
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

    if (event.button !== 0 || !isBrushTool(tool) || worldPoint === null) {
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

  const endPointerInteraction = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (drawingStateRef.current?.pointerId === event.pointerId) {
      if (cancelled) {
        drawingStateRef.current = null;
        rendererRef.current?.setTerrainPreview(null);
      } else {
        finishDrawing(event);
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
        if (drawingStateRef.current === null) {
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
