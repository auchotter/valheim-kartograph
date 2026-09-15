import { Texture } from 'pixi.js';
import type { Biome } from '../../../shared/domain';
import { biomeStyle } from './biomeStyles';
import type { MapAppearance } from './mapAppearance';

/**
 * Modern keeps the high-resolution source tuned for the supported 800% map
 * zoom. Immersive intentionally uses a smaller nearest-sampled source to give
 * its biome paint a controlled retro pixel character.
 */
export const BIOME_PATTERN_SOURCE_RESOLUTION = 8;
export const IMMERSIVE_BIOME_PATTERN_SOURCE_RESOLUTION = 0.375;

const textureCache = new Map<Biome, Texture>();
let activeTextureAppearance: MapAppearance = 'modern';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function biomeSeed(biome: Biome): number {
  let seed = 17_381;
  for (const character of biome) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 1_664_525) + 1_013_904_223;
  }
  return seed >>> 0;
}

function shiftedHex(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 0xff, value & 0xff].map((channel) =>
    Math.max(0, Math.min(255, channel + amount)),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function drawImmersiveBaseVariation(
  context: CanvasRenderingContext2D,
  size: number,
  baseHex: string,
  biome: Biome,
): void {
  const random = seededRandom(biomeSeed(biome));
  const darker = shiftedHex(baseHex, -13);
  const lighter = shiftedHex(baseHex, 11);
  const warm = shiftedHex(baseHex, 5);

  // Small irregular opaque clusters sit underneath the existing motif. The
  // nearest-sampled 0.375× source turns these into deliberate 3px game-map
  // colour steps without affecting Modern's 8× source.
  for (let index = 0; index < 3200; index += 1) {
    const roll = random();
    const color = roll < 0.11 ? darker : roll < 0.2 ? lighter : roll < 0.27 ? warm : null;
    if (color === null) {
      continue;
    }
    const width = random() < 0.68 ? 3 : random() < 0.93 ? 4 : 5;
    const height = random() < 0.2 ? 2 : random() < 0.92 ? 3 : 4;
    context.fillStyle = color;
    context.fillRect(Math.floor(random() * size), Math.floor(random() * size), width, height);
    if (random() > 0.78) {
      context.fillRect(Math.floor(random() * size), Math.floor(random() * size), 3, 3);
    }
  }
}

function activeSourceResolution(appearance: MapAppearance): number {
  return appearance === 'immersive'
    ? IMMERSIVE_BIOME_PATTERN_SOURCE_RESOLUTION
    : BIOME_PATTERN_SOURCE_RESOLUTION;
}

function activeScaleMode(appearance: MapAppearance): 'linear' | 'nearest' {
  return appearance === 'immersive' ? 'nearest' : 'linear';
}

/** Releases the one active theme's sources before the terrain is rebuilt. */
export function setBiomeTextureAppearance(appearance: MapAppearance): void {
  if (appearance === activeTextureAppearance) {
    return;
  }
  for (const texture of textureCache.values()) {
    texture.destroy(true);
  }
  textureCache.clear();
  activeTextureAppearance = appearance;
}

/** Creates each opaque biome pattern once for the life of the frontend. */
export function biomeTexture(biome: Biome): Texture {
  const cached = textureCache.get(biome);
  if (cached !== undefined) {
    return cached;
  }

  const style = biomeStyle(biome, activeTextureAppearance);
  const sourceResolution = activeSourceResolution(activeTextureAppearance);
  const scaleMode = activeScaleMode(activeTextureAppearance);
  const canvas = document.createElement('canvas');
  canvas.width = style.tileSize * sourceResolution;
  canvas.height = style.tileSize * sourceResolution;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Unable to create a biome pattern canvas.');
  }

  // Existing pattern functions use logical world-tile coordinates. Scaling the
  // canvas context preserves their geometry and spacing while the per-theme
  // resolution keeps the logical Pixi tile at 192.
  context.scale(sourceResolution, sourceResolution);
  context.imageSmoothingEnabled = scaleMode === 'linear';

  // The source tile is completely opaque. Texture detail is blended into its
  // pixels here, so reapplying this tile never compounds translucency.
  context.fillStyle = style.baseHex;
  context.fillRect(0, 0, style.tileSize, style.tileSize);
  if (activeTextureAppearance === 'immersive') {
    drawImmersiveBaseVariation(context, style.tileSize, style.baseHex, biome);
  }
  style.drawPattern(context, style.tileSize, style.markHex, style.snowHex);

  const texture = Texture.from({
    resource: canvas,
    resolution: sourceResolution,
    scaleMode,
  });
  textureCache.set(biome, texture);
  return texture;
}
