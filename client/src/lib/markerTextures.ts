import { Assets, Texture } from 'pixi.js';
import type { Biome } from '../../../shared/domain';
import { markerTextureUrl } from './markerIcons';

const textureCache = new Map<string, Texture>();
const textureLoads = new Map<string, Promise<Texture>>();

/**
 * Returns the loaded texture when available, otherwise a harmless transparent
 * placeholder. Pixi's Texture.from() only reads its cache for string URLs in
 * this runtime; it is not an asynchronous image loader.
 */
export function markerTexture(markerType: string, directional = false, biome: Biome | null = null): Texture {
  const url = markerTextureUrl(markerType, directional, biome);
  return textureCache.get(url) ?? Texture.EMPTY;
}

/** Loads and retains exactly one nearest-neighbour texture for each PNG URL. */
export function loadMarkerTexture(markerType: string, directional = false, biome: Biome | null = null): Promise<Texture> {
  const url = markerTextureUrl(markerType, directional, biome);
  const cached = textureCache.get(url);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  const pending = textureLoads.get(url);
  if (pending !== undefined) {
    return pending;
  }

  const load = Assets.load<Texture>(url)
    .then((texture) => {
      texture.source.style.scaleMode = 'nearest';
      textureCache.set(url, texture);
      return texture;
    })
    .finally(() => textureLoads.delete(url));
  textureLoads.set(url, load);
  return load;
}
