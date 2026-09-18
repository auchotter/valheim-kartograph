import type { Biome } from '../../../shared/domain';

export const PATH_DARK_COLOR = 0x4b463d;
export const PATH_LIGHT_COLOR = 0xe8e1d1;
export const PATH_DOT_RADIUS_CSS = 1.7;
export const PATH_DOT_SPACING_CSS = 8;
export const MAP_TEXT_NORMAL_COLOR = 0x3f3a33;

/**
 * Semantic terrain contrast used by both dotted Paths and map text. The
 * renderer still maps this to the existing Path colours, while captions and
 * Labels can make their own presentation choice without duplicating biome
 * lists.
 */
export type TerrainContrastClass = 'light-ground' | 'dark-ground' | 'ashlands' | 'neutral';

export function terrainContrastClassForBiome(biome: Biome | null): TerrainContrastClass {
  if (biome === null || biome === 'mountains' || biome === 'deep_north' || biome === 'ocean') {
    return 'light-ground';
  }
  if (biome === 'black_forest') {
    return 'dark-ground';
  }
  if (biome === 'ashlands' || biome === 'mistlands') {
    return 'ashlands';
  }
  return 'neutral';
}

/** Returns a deterministic channel-scaled colour without compounding edits. */
export function scaleRgbColor(color: number, factor: number): number {
  const safeFactor = Number.isFinite(factor) ? Math.max(0, factor) : 1;
  const red = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * safeFactor)));
  const green = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * safeFactor)));
  const blue = Math.min(255, Math.max(0, Math.round((color & 0xff) * safeFactor)));
  return (red << 16) | (green << 8) | blue;
}

export function textColorForVisibleBiome(biome: Biome | null): number {
  switch (terrainContrastClassForBiome(biome)) {
    case 'dark-ground':
      return PATH_LIGHT_COLOR;
    case 'ashlands':
      return scaleRgbColor(MAP_TEXT_NORMAL_COLOR, 0.8);
    default:
      return MAP_TEXT_NORMAL_COLOR;
  }
}

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
  return terrainContrastClassForBiome(biome) === 'light-ground'
    ? PATH_DARK_COLOR
    : PATH_LIGHT_COLOR;
}
