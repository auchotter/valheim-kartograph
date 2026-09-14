import { Texture } from 'pixi.js';

/**
 * The paper is intentionally made from three independent repeat domains. The
 * awkward periods keep their combined visual repeat far beyond normal map use,
 * while each source remains small and bounded in memory.
 */
export const PARCHMENT_TEXTURE_LAYERS = {
  broad: { logicalPeriod: 3072, physicalSize: 768, seed: 17_381, scaleMode: 'linear' as const },
  grain: { logicalPeriod: 1103, physicalSize: 896, seed: 52_917, scaleMode: 'nearest' as const },
  flecks: { logicalPeriod: 677, physicalSize: 640, seed: 83_741, scaleMode: 'nearest' as const },
} as const;

export interface ParchmentTextures {
  broad: Texture;
  grain: Texture;
  flecks: Texture;
}

let cachedTextures: ParchmentTextures | null = null;

type Random = () => number;

function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function rgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`;
}

function hashGrid(x: number, y: number, seed: number): number {
  let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x1_0000_0000;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const top = hashGrid(x0, y0, seed) + (hashGrid(x0 + 1, y0, seed) - hashGrid(x0, y0, seed)) * tx;
  const bottom = hashGrid(x0, y0 + 1, seed) + (hashGrid(x0 + 1, y0 + 1, seed) - hashGrid(x0, y0 + 1, seed)) * tx;
  return top + (bottom - top) * ty;
}

function wrappedOffsets(period: number): readonly [number, number][] {
  return [
    [-period, -period], [0, -period], [period, -period],
    [-period, 0], [0, 0], [period, 0],
    [-period, period], [0, period], [period, period],
  ];
}

function drawWrapped(
  context: CanvasRenderingContext2D,
  period: number,
  x: number,
  y: number,
  draw: (offsetX: number, offsetY: number) => void,
): void {
  for (const [offsetX, offsetY] of wrappedOffsets(period)) {
    draw(x + offsetX, y + offsetY);
  }
}

function createCanvasTexture(
  period: number,
  physicalSize: number,
  scaleMode: 'linear' | 'nearest',
  draw: (context: CanvasRenderingContext2D, random: Random) => void,
  seed: number,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = physicalSize;
  canvas.height = physicalSize;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Unable to create parchment texture canvas.');
  }

  // Draw in logical world units; the source resolution tells Pixi that this
  // modest canvas represents the much larger world-space period.
  context.scale(physicalSize / period, physicalSize / period);
  context.imageSmoothingEnabled = scaleMode === 'linear';
  draw(context, seededRandom(seed));

  return Texture.from({
    resource: canvas,
    resolution: physicalSize / period,
    addressMode: 'repeat',
    scaleMode,
  });
}

function drawBroadMottle(context: CanvasRenderingContext2D, _random: Random): void {
  const period = PARCHMENT_TEXTURE_LAYERS.broad.logicalPeriod;
  const width = context.canvas.width;
  const height = context.canvas.height;
  const image = context.createImageData(width, height);
  const data = image.data;

  // A smooth, multi-scale value field keeps the broad layer tonal rather than
  // turning it into a collection of recognizable marks.
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const worldX = (pixelX / width) * period;
      const worldY = (pixelY / height) * period;
      const large = valueNoise((worldX * 0.97 + worldY * 0.23) / 92, (worldY * 0.97 - worldX * 0.17) / 92, 17_381);
      const medium = valueNoise((worldX * 0.83 - worldY * 0.31) / 56, (worldY * 0.91 + worldX * 0.19) / 56, 17_419);
      const fine = valueNoise((worldX * 0.71 + worldY * 0.43) / 32, (worldY * 0.79 - worldX * 0.37) / 32, 17_453);
      const tone = large * 0.58 + medium * 0.29 + fine * 0.13;
      const centered = tone - 0.5;
      const strength = Math.min(1, Math.abs(centered) * 2.2);
      const alpha = 0.024 + strength * 0.04;
      const color = centered < 0 ? [122, 90, 56] : [232, 206, 147];
      const offset = (pixelY * width + pixelX) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
}

function drawGrain(context: CanvasRenderingContext2D, random: Random): void {
  const period = PARCHMENT_TEXTURE_LAYERS.grain.logicalPeriod;
  const dark = '#725033';
  const warmGrey = '#806B4F';

  for (let index = 0; index < 6000; index += 1) {
    const x = random() * period;
    const y = random() * period;
    const width = random() < 0.86 ? 1 : random() < 0.97 ? 2 : 3;
    const height = random() < 0.84 ? 1 : random() < 0.97 ? 2 : 3;
    const color = random() > 0.45 ? dark : warmGrey;
    const alpha = 0.032 + random() * 0.048;
    const extend = random() > 0.74;
    drawWrapped(context, period, x, y, (wrappedX, wrappedY) => {
      context.fillStyle = rgba(color, alpha);
      context.fillRect(wrappedX, wrappedY, width, height);
      if (extend) {
        context.fillRect(wrappedX + width, wrappedY, 1, height);
      }
    });
  }
}

function drawFlecksAndFibres(context: CanvasRenderingContext2D, random: Random): void {
  const period = PARCHMENT_TEXTURE_LAYERS.flecks.logicalPeriod;
  const dark = '#6A4A30';
  const light = '#F0DBA5';

  for (let index = 0; index < 90; index += 1) {
    const x = random() * period;
    const y = random() * period;
    const width = 2 + Math.floor(random() * 3);
    const height = 1 + Math.floor(random() * 2);
    const color = random() > 0.27 ? dark : light;
    const alpha = color === dark ? 0.085 + random() * 0.065 : 0.05 + random() * 0.06;
    const extend = random() > 0.7;
    drawWrapped(context, period, x, y, (wrappedX, wrappedY) => {
      context.fillStyle = rgba(color, alpha);
      context.fillRect(wrappedX, wrappedY, width, height);
      if (extend) {
        context.fillRect(wrappedX - 1, wrappedY + height, Math.max(1, width - 2), 1);
      }
    });
  }

  for (let index = 0; index < 40; index += 1) {
    const x = random() * period;
    const y = random() * period;
    const length = 2 + random() * 4;
    const step = random() > 0.5 ? 1 : 0;
    const color = random() > 0.3 ? dark : light;
    const alpha = color === dark ? 0.05 + random() * 0.055 : 0.04 + random() * 0.05;
    drawWrapped(context, period, x, y, (wrappedX, wrappedY) => {
      context.fillStyle = rgba(color, alpha);
      for (let segment = 0; segment < length; segment += 1) {
        const verticalOffset = segment > length * 0.45 && segment < length * 0.72 ? step : 0;
        context.fillRect(wrappedX + segment, wrappedY + verticalOffset, 1, 1);
      }
    });
  }
}

export function parchmentTextures(): ParchmentTextures {
  if (cachedTextures !== null) {
    return cachedTextures;
  }
  cachedTextures = {
    broad: createCanvasTexture(
      PARCHMENT_TEXTURE_LAYERS.broad.logicalPeriod,
      PARCHMENT_TEXTURE_LAYERS.broad.physicalSize,
      PARCHMENT_TEXTURE_LAYERS.broad.scaleMode,
      drawBroadMottle,
      PARCHMENT_TEXTURE_LAYERS.broad.seed,
    ),
    grain: createCanvasTexture(
      PARCHMENT_TEXTURE_LAYERS.grain.logicalPeriod,
      PARCHMENT_TEXTURE_LAYERS.grain.physicalSize,
      PARCHMENT_TEXTURE_LAYERS.grain.scaleMode,
      drawGrain,
      PARCHMENT_TEXTURE_LAYERS.grain.seed,
    ),
    flecks: createCanvasTexture(
      PARCHMENT_TEXTURE_LAYERS.flecks.logicalPeriod,
      PARCHMENT_TEXTURE_LAYERS.flecks.physicalSize,
      PARCHMENT_TEXTURE_LAYERS.flecks.scaleMode,
      drawFlecksAndFibres,
      PARCHMENT_TEXTURE_LAYERS.flecks.seed,
    ),
  };
  return cachedTextures;
}

export function destroyParchmentTextures(): void {
  if (cachedTextures === null) {
    return;
  }
  cachedTextures.broad.destroy(true);
  cachedTextures.grain.destroy(true);
  cachedTextures.flecks.destroy(true);
  cachedTextures = null;
}
