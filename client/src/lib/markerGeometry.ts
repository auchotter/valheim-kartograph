import type { Marker, WorldPoint } from '../../../shared/domain';
import {
  MARKER_BASE_SIZE_CSS,
  MARKER_ICON_VIEWBOX,
  normaliseDirectionDegrees,
} from './markerIcons';

export const MARKER_CAPTION_BASE_FONT_SIZE_CSS = 12;

/**
 * Marker icon size is a local camera presentation concern. Persisted
 * `sizeScale` values remain compatibility data and deliberately do not enter
 * this calculation.
 */
export function markerVisualScale(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? zoom : 0.1;
  if (safeZoom <= 0.05) return 0.85;
  if (safeZoom <= 0.1) return 0.85 + ((safeZoom - 0.05) / 0.05) * 0.15;
  if (safeZoom <= 0.5) return 1 + (safeZoom - 0.1) / 0.4;
  if (safeZoom < 1) return 2 + (safeZoom - 0.5) / 0.5;
  return 3;
}

export function markerVisualDiameterCss(zoom: number): number {
  return MARKER_BASE_SIZE_CSS * markerVisualScale(zoom);
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

/** The normalized icon-box scale for the current continuous camera scale. */
export function markerIconLocalScale(zoom: number): number {
  return markerVisualDiameterCss(zoom) / MARKER_ICON_VIEWBOX;
}

/** Useful for verification: the complete camera/root/vector scale chain. */
export function markerRenderedScreenSizeCss(zoom: number): number {
  return MARKER_ICON_VIEWBOX * markerIconLocalScale(zoom) * markerRootWorldScale(zoom) * zoom;
}

/** Caption coordinates live in the marker root's screen-local coordinate space. */
export function markerCaptionOffsetCss(zoom: number): number {
  return markerVisualDiameterCss(zoom) / 2 + 7;
}

/** Captions use exactly the same continuous zoom scale as their icons. */
export function markerCaptionScale(zoom: number): number {
  return markerVisualScale(zoom);
}

export function markerCaptionFontSizeCss(zoom: number): number {
  return MARKER_CAPTION_BASE_FONT_SIZE_CSS * markerCaptionScale(zoom);
}

/** Map captions are omitted at extreme low zoom while marker icons remain visible. */
export function markerCaptionVisible(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= 0.2;
}

export function markerCaptionRenderedFontSizeCss(fontSize: number, zoom: number): number {
  return fontSize * markerRootWorldScale(zoom) * zoom;
}

export function markerHitRadiusWorld(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return (markerVisualDiameterCss(safeZoom) / 2 + 9) / safeZoom;
}

/** Later-created markers win, matching their Maps-layer display order. */
export function hitTestMarker(markers: readonly Marker[], point: WorldPoint, zoom: number): Marker | null {
  const ordered = [...markers].sort((left, right) => right.orderKey - left.orderKey);
  return (
    ordered.find((marker) => {
      const radius = markerHitRadiusWorld(zoom);
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
