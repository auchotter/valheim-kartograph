import type { Marker, WorldPoint } from '../../../shared/domain';
import {
  MARKER_BASE_SIZE_CSS,
  MARKER_ICON_VIEWBOX,
  clampMarkerSizeScale,
  normaliseDirectionDegrees,
} from './markerIcons';

export function markerVisualDiameterCss(sizeScale: number): number {
  return MARKER_BASE_SIZE_CSS * clampMarkerSizeScale(sizeScale);
}

/**
 * Reduces only deliberate enlargement while the map is zoomed far out. The
 * stored sizeScale remains authoritative and is never mutated by this view
 * calculation.
 */
export function effectiveMarkerSizeScale(sizeScale: number, zoom: number): number {
  const storedScale = clampMarkerSizeScale(sizeScale);
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const zoomFactor = Math.min(1, Math.max(0, safeZoom / 0.5));
  return storedScale < 1 ? storedScale : 1 + (storedScale - 1) * zoomFactor;
}

export function effectiveMarkerVisualDiameterCss(sizeScale: number, zoom: number): number {
  return MARKER_BASE_SIZE_CSS * effectiveMarkerSizeScale(sizeScale, zoom);
}

/**
 * Markers live under the camera-scaled overlay container. Each marker's visual
 * child counter-scales exactly once so authored screen-local children stay
 * CSS-sized without changing the marker root's world position.
 */
export function markerRootWorldScale(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return 1 / safeZoom;
}

/** The 64-unit vector's local scale; this is independent of camera zoom. */
export function markerIconLocalScale(sizeScale: number, zoom = 1): number {
  return effectiveMarkerVisualDiameterCss(sizeScale, zoom) / MARKER_ICON_VIEWBOX;
}

/** Useful for verification: the complete camera/root/vector scale chain. */
export function markerRenderedScreenSizeCss(sizeScale: number, zoom: number): number {
  return MARKER_ICON_VIEWBOX * markerIconLocalScale(sizeScale, zoom) * markerRootWorldScale(zoom) * zoom;
}

/** Caption coordinates live in the marker root's screen-local coordinate space. */
export function markerCaptionOffsetCss(sizeScale: number, zoom = 1): number {
  return effectiveMarkerVisualDiameterCss(sizeScale, zoom) / 2 + 7;
}

export function markerCaptionRenderedFontSizeCss(fontSize: number, zoom: number): number {
  return fontSize * markerRootWorldScale(zoom) * zoom;
}

export function markerHitRadiusWorld(marker: Pick<Marker, 'sizeScale'>, zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return (effectiveMarkerVisualDiameterCss(marker.sizeScale, zoom) / 2 + 9) / safeZoom;
}

/** Later-created markers win, matching their Maps-layer display order. */
export function hitTestMarker(markers: readonly Marker[], point: WorldPoint, zoom: number): Marker | null {
  const ordered = [...markers].sort((left, right) => right.orderKey - left.orderKey);
  return (
    ordered.find((marker) => {
      const radius = markerHitRadiusWorld(marker, zoom);
      return Math.hypot(point[0] - marker.x, point[1] - marker.y) <= radius;
    }) ?? null
  );
}

export function movedMarker(marker: Marker, point: WorldPoint): Marker {
  return { ...marker, x: point[0], y: point[1] };
}

export function markerWithDirection(marker: Marker, directionDegrees: number): Marker {
  return { ...marker, directionDegrees: normaliseDirectionDegrees(directionDegrees) };
}
