import type { Biome } from '../../../shared/domain';

export interface BiomeStyle {
  label: string;
  /** Opaque terrain base, documented as a CSS hex value for art-direction review. */
  baseHex: `#${string}`;
  /** Darker/lighter opaque-tile mark colour. */
  markHex: `#${string}`;
  tileSize: number;
  drawPattern: (context: CanvasRenderingContext2D, size: number, markHex: string) => void;
}

export const BIOME_STYLES: Readonly<Record<Biome, BiomeStyle>> = {
  ocean: {
    label: 'Ocean',
    baseHex: '#B7CDD2',
    markHex: '#6F929E',
    tileSize: 192,
    drawPattern: drawOceanPattern,
  },
  meadows: {
    label: 'Meadows',
    baseHex: '#91A96B',
    markHex: '#6F8754',
    tileSize: 192,
    drawPattern: drawMeadowPattern,
  },
  black_forest: {
    label: 'Black Forest',
    baseHex: '#365E4B',
    markHex: '#244536',
    tileSize: 192,
    drawPattern: drawBlackForestPattern,
  },
  swamp: {
    label: 'Swamp',
    baseHex: '#78684B',
    markHex: '#584C38',
    tileSize: 192,
    drawPattern: drawSwampPattern,
  },
  mountains: {
    label: 'Mountains',
    baseHex: '#D9DEE1',
    markHex: '#A4ADB4',
    tileSize: 192,
    drawPattern: drawMountainPattern,
  },
  plains: {
    label: 'Plains',
    baseHex: '#C4A75E',
    markHex: '#9B7F3F',
    tileSize: 192,
    drawPattern: drawPlainsPattern,
  },
  mistlands: {
    label: 'Mistlands',
    baseHex: '#81798D',
    markHex: '#625A70',
    tileSize: 192,
    drawPattern: drawMistlandsPattern,
  },
  ashlands: {
    label: 'Ashlands',
    baseHex: '#924E3E',
    markHex: '#5F332B',
    tileSize: 192,
    drawPattern: drawAshlandsPattern,
  },
  lava: {
    label: 'Lava',
    baseHex: '#D79A35',
    markHex: '#A64B27',
    tileSize: 192,
    drawPattern: drawLavaPattern,
  },
  deep_north: {
    label: 'Deep North',
    baseHex: '#5F8396',
    markHex: '#B7CDD2',
    tileSize: 192,
    drawPattern: drawDeepNorthPattern,
  },
};

/** Deliberate toolbar order; this is not derived from object-key insertion order. */
export const BIOMES: readonly Biome[] = [
  'ocean',
  'meadows',
  'black_forest',
  'swamp',
  'mountains',
  'plains',
  'mistlands',
  'ashlands',
  'lava',
  'deep_north',
];

export function biomeStyle(biome: Biome): BiomeStyle {
  return BIOME_STYLES[biome];
}

export function biomeColor(biome: Biome): number {
  return Number.parseInt(biomeStyle(biome).baseHex.slice(1), 16);
}

function prepareStroke(context: CanvasRenderingContext2D, color: string, alpha: number, width: number) {
  context.strokeStyle = color;
  context.globalAlpha = alpha;
  context.lineWidth = width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
}

function drawMeadowPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.52, 1.35);
  for (let index = 0; index < 22; index += 1) {
    const x = 8 + ((index * 29) % size);
    const y = 14 + ((index * 47) % (size - 18));
    context.beginPath();
    context.moveTo(x, y + 6);
    context.quadraticCurveTo(x + (index % 2 === 0 ? 3 : -3), y + 1, x + 1, y - 4);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawBlackForestPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.58, 1.15);
  for (let index = 0; index < 9; index += 1) {
    const x = 14 + ((index * 53) % (size - 28));
    const y = 18 + ((index * 71) % (size - 34));
    context.beginPath();
    context.moveTo(x, y + 11);
    context.lineTo(x, y - 10);
    context.moveTo(x - 7, y + 2);
    context.lineTo(x, y - 4);
    context.lineTo(x + 7, y + 2);
    context.moveTo(x - 5, y - 3);
    context.lineTo(x, y - 9);
    context.lineTo(x + 5, y - 3);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawSwampPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.44, 1.5);
  for (let index = 0; index < 12; index += 1) {
    const x = 10 + ((index * 41) % (size - 28));
    const y = 12 + ((index * 67) % (size - 24));
    context.beginPath();
    context.ellipse(x, y, 10 + (index % 3) * 3, 3 + (index % 2), -0.25, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawMountainPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.58, 1.25);
  for (let index = 0; index < 9; index += 1) {
    const x = 10 + ((index * 47) % (size - 30));
    const y = 12 + ((index * 61) % (size - 32));
    context.beginPath();
    context.moveTo(x - 9, y + 8);
    context.lineTo(x, y - 11);
    context.lineTo(x + 11, y + 9);
    context.lineTo(x + 4, y + 4);
    context.lineTo(x - 2, y + 9);
    context.stroke();
  }
  prepareStroke(context, '#F4F7F7', 0.72, 1);
  for (let index = 0; index < 5; index += 1) {
    const x = 19 + ((index * 67) % (size - 38));
    const y = 20 + ((index * 43) % (size - 38));
    snowflake(context, x, y, 3.5);
  }
  context.globalAlpha = 1;
}

function drawPlainsPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.48, 1.05);
  for (let index = 0; index < 30; index += 1) {
    const x = 5 + ((index * 23) % (size - 10));
    const y = 8 + ((index * 37) % (size - 16));
    context.beginPath();
    context.moveTo(x, y + 5);
    context.lineTo(x + (index % 3) - 1, y - 4);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawMistlandsPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.38, 1.8);
  for (let index = 0; index < 10; index += 1) {
    const x = -12 + ((index * 41) % size);
    const y = 13 + ((index * 59) % (size - 24));
    context.beginPath();
    context.moveTo(x, y);
    context.bezierCurveTo(x + 13, y - 8, x + 23, y + 8, x + 38, y);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawAshlandsPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.62, 1.25);
  for (let index = 0; index < 14; index += 1) {
    const x = 8 + ((index * 37) % (size - 16));
    const y = 8 + ((index * 71) % (size - 16));
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 6, y + 4);
    context.lineTo(x + 10, y + 1);
    context.lineTo(x + 15, y + 7);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawLavaPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.58, 1.6);
  for (let index = 0; index < 12; index += 1) {
    const x = -14 + ((index * 43) % size);
    const y = 12 + ((index * 67) % (size - 24));
    context.beginPath();
    context.moveTo(x, y);
    context.bezierCurveTo(x + 12, y - 6, x + 23, y + 8, x + 39, y + 2);
    context.bezierCurveTo(x + 48, y - 2, x + 55, y + 4, x + 66, y - 1);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawDeepNorthPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.4, 1);
  for (let index = 0; index < 10; index += 1) {
    const x = 12 + ((index * 53) % (size - 24));
    const y = 12 + ((index * 73) % (size - 24));
    context.beginPath();
    context.moveTo(x, y - 6);
    context.lineTo(x + 5, y);
    context.lineTo(x, y + 6);
    context.lineTo(x - 5, y);
    context.closePath();
    context.stroke();
    snowflake(context, x + 13, y + 7, 2.5);
  }
  context.globalAlpha = 1;
}

function drawOceanPattern(context: CanvasRenderingContext2D, size: number, markHex: string): void {
  prepareStroke(context, markHex, 0.46, 1.25);
  for (let index = 0; index < 16; index += 1) {
    const x = -6 + ((index * 37) % size);
    const y = 10 + ((index * 43) % (size - 18));
    context.beginPath();
    context.quadraticCurveTo(x + 6, y - 4, x + 12, y);
    context.quadraticCurveTo(x + 18, y + 4, x + 24, y);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function snowflake(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  context.moveTo(x - radius, y);
  context.lineTo(x + radius, y);
  context.moveTo(x, y - radius);
  context.lineTo(x, y + radius);
  context.moveTo(x - radius * 0.7, y - radius * 0.7);
  context.lineTo(x + radius * 0.7, y + radius * 0.7);
  context.moveTo(x + radius * 0.7, y - radius * 0.7);
  context.lineTo(x - radius * 0.7, y + radius * 0.7);
  context.stroke();
}
