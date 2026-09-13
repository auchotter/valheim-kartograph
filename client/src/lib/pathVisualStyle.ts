import type { Biome } from '../../../shared/domain';

export const PATH_DARK_COLOR = 0x4b463d;
export const PATH_LIGHT_COLOR = 0xe8e1d1;
export const PATH_DOT_RADIUS_CSS = 1.7;
export const PATH_DOT_SPACING_CSS = 8;

export interface DottedPathVisualStyle {
  radiusWorld: number;
  spacingWorld: number;
}

/** Keeps the single dotted path mark screen-consistent. */
export function dottedPathVisualStyle(zoom: number, highlighted = false): DottedPathVisualStyle {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const radiusCss = PATH_DOT_RADIUS_CSS + (highlighted ? 1.15 : 0);
  return {
    radiusWorld: radiusCss / safeZoom,
    spacingWorld: PATH_DOT_SPACING_CSS / safeZoom,
  };
}

/** Dark dots belong on the naturally light terrain and parchment. */
export function pathColorForVisibleBiome(biome: Biome | null): number {
  return biome === null || biome === 'mountains' || biome === 'ocean'
    ? PATH_DARK_COLOR
    : PATH_LIGHT_COLOR;
}
