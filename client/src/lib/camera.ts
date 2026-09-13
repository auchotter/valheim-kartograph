import type { WorldPoint } from '../../../shared/domain';

export interface Camera {
  /** World coordinate positioned at the centre of the viewport. */
  cameraX: number;
  cameraY: number;
  /** Screen pixels per world unit. */
  zoom: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export const DEFAULT_CAMERA: Camera = {
  cameraX: 0,
  cameraY: 0,
  zoom: DEFAULT_ZOOM,
};

export function isFiniteCamera(camera: Camera): boolean {
  return (
    Number.isFinite(camera.cameraX) &&
    Number.isFinite(camera.cameraY) &&
    Number.isFinite(camera.zoom) &&
    camera.zoom > 0
  );
}

export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) {
    return DEFAULT_ZOOM;
  }

  if (zoom === Number.POSITIVE_INFINITY) {
    return MAX_ZOOM;
  }

  if (zoom === Number.NEGATIVE_INFINITY || zoom <= 0) {
    return MIN_ZOOM;
  }

  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(
  screenPoint: ScreenPoint,
  camera: Camera,
  viewport: ViewportSize,
): WorldPoint {
  return [
    camera.cameraX + (screenPoint.x - viewport.width / 2) / camera.zoom,
    camera.cameraY + (screenPoint.y - viewport.height / 2) / camera.zoom,
  ];
}

export function worldToScreen(
  worldPoint: WorldPoint,
  camera: Camera,
  viewport: ViewportSize,
): ScreenPoint {
  return {
    x: viewport.width / 2 + (worldPoint[0] - camera.cameraX) * camera.zoom,
    y: viewport.height / 2 + (worldPoint[1] - camera.cameraY) * camera.zoom,
  };
}

/** Keeps the world point beneath a screen point stationary while changing zoom. */
export function zoomAtScreenPoint(
  camera: Camera,
  screenPoint: ScreenPoint,
  viewport: ViewportSize,
  requestedZoom: number,
): Camera {
  if (!isFiniteCamera(camera) || !isFiniteViewport(viewport) || !isFinitePoint(screenPoint)) {
    return camera;
  }

  const zoom = clampZoom(requestedZoom);
  const [worldX, worldY] = screenToWorld(screenPoint, camera, viewport);
  const nextCamera: Camera = {
    cameraX: worldX - (screenPoint.x - viewport.width / 2) / zoom,
    cameraY: worldY - (screenPoint.y - viewport.height / 2) / zoom,
    zoom,
  };

  return isFiniteCamera(nextCamera) ? nextCamera : camera;
}

/** Applies a screen-pixel drag delta to the camera. */
export function panCameraByScreenDelta(camera: Camera, delta: ScreenPoint): Camera {
  if (!isFiniteCamera(camera) || !isFinitePoint(delta)) {
    return camera;
  }

  const nextCamera: Camera = {
    cameraX: camera.cameraX - delta.x / camera.zoom,
    cameraY: camera.cameraY - delta.y / camera.zoom,
    zoom: camera.zoom,
  };

  return isFiniteCamera(nextCamera) ? nextCamera : camera;
}

function isFiniteViewport(viewport: ViewportSize): boolean {
  return (
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0
  );
}

function isFinitePoint(point: ScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
