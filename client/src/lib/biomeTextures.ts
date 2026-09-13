import { Texture } from 'pixi.js';
import type { Biome } from '../../../shared/domain';
import { biomeStyle } from './biomeStyles';

const textureCache = new Map<Biome, Texture>();

/** Creates each opaque biome pattern once for the life of the frontend. */
export function biomeTexture(biome: Biome): Texture {
  const cached = textureCache.get(biome);
  if (cached !== undefined) {
    return cached;
  }

  const style = biomeStyle(biome);
  const canvas = document.createElement('canvas');
  canvas.width = style.tileSize;
  canvas.height = style.tileSize;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Unable to create a biome pattern canvas.');
  }

  // The source tile is completely opaque. Texture detail is blended into its
  // pixels here, so reapplying this tile never compounds translucency.
  context.fillStyle = style.baseHex;
  context.fillRect(0, 0, canvas.width, canvas.height);
  style.drawPattern(context, style.tileSize, style.markHex);

  const texture = Texture.from(canvas);
  textureCache.set(biome, texture);
  return texture;
}
