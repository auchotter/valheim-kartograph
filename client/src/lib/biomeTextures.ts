import { Texture } from 'pixi.js';
import type { Biome } from '../../../shared/domain';
import { biomeStyle } from './biomeStyles';

/**
 * Keep the 192-world-unit pattern tile, but rasterise it densely enough for
 * the supported 800% map zoom. This is deliberately fixed rather than DPR- or
 * zoom-driven so every biome still has one bounded cached source texture.
 */
export const BIOME_PATTERN_SOURCE_RESOLUTION = 8;

const textureCache = new Map<Biome, Texture>();

/** Creates each opaque biome pattern once for the life of the frontend. */
export function biomeTexture(biome: Biome): Texture {
  const cached = textureCache.get(biome);
  if (cached !== undefined) {
    return cached;
  }

  const style = biomeStyle(biome);
  const canvas = document.createElement('canvas');
  canvas.width = style.tileSize * BIOME_PATTERN_SOURCE_RESOLUTION;
  canvas.height = style.tileSize * BIOME_PATTERN_SOURCE_RESOLUTION;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Unable to create a biome pattern canvas.');
  }

  // Existing pattern functions use logical world-tile coordinates. Scaling the
  // canvas context preserves their geometry and spacing while adding source
  // detail. The texture resolution below keeps the logical Pixi tile at 192.
  context.scale(BIOME_PATTERN_SOURCE_RESOLUTION, BIOME_PATTERN_SOURCE_RESOLUTION);

  // The source tile is completely opaque. Texture detail is blended into its
  // pixels here, so reapplying this tile never compounds translucency.
  context.fillStyle = style.baseHex;
  context.fillRect(0, 0, style.tileSize, style.tileSize);
  style.drawPattern(context, style.tileSize, style.markHex);

  const texture = Texture.from({
    resource: canvas,
    resolution: BIOME_PATTERN_SOURCE_RESOLUTION,
  });
  textureCache.set(biome, texture);
  return texture;
}
