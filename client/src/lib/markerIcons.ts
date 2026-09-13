import type { Graphics } from 'pixi.js';

export const MARKER_ICON_VIEWBOX = 64;
export const MARKER_BASE_SIZE_CSS = 32;
export const MARKER_SIZE_STEP = 0.25;
export const MARKER_MIN_SIZE_SCALE = 0.5;
export const MARKER_MAX_SIZE_SCALE = 3;
export const MARKER_SYMBOL_COLOR = '#403B34';
export const MARKER_RED_CROSS_COLOR = '#9A3F3C';
export const MARKER_GREEN_TICK_COLOR = '#48744E';

export type MarkerGroup = 'Navigation / status' | 'Base / travel' | 'Resources' | 'Dungeons / danger' | 'Landmarks / special';

export interface MarkerIconDefinition {
  type: string;
  label: string;
  group: MarkerGroup;
}

const icon = (type: string, label: string, group: MarkerGroup): MarkerIconDefinition => ({ type, label, group });

/**
 * Project-owned, 64-unit cartographic pictograms. `markerSvgMarkup` is the
 * single source used by both the HTML palette and Pixi map symbols.
 */
export const MARKER_ICONS: readonly MarkerIconDefinition[] = [
  icon('death_skull', 'Death', 'Dungeons / danger'),
  icon('boss', 'Boss', 'Dungeons / danger'),
  icon('trader', 'Trader', 'Navigation / status'),
  icon('pet', 'Pet', 'Base / travel'),
  icon('home', 'Home', 'Base / travel'),
  icon('campfire', 'Campfire', 'Base / travel'),
  icon('circle', 'Circle', 'Navigation / status'),
  icon('red_cross', 'Red Cross', 'Navigation / status'),
  icon('green_tick', 'Green Tick', 'Navigation / status'),
  icon('tent', 'Tent', 'Base / travel'),
  icon('castle', 'Castle', 'Base / travel'),
  icon('dragon_egg', 'Dragon Egg', 'Landmarks / special'),
  icon('chest', 'Chest', 'Base / travel'),
  icon('portal', 'Portal', 'Landmarks / special'),
  icon('cave', 'Cave', 'Dungeons / danger'),
  icon('village', 'Village', 'Landmarks / special'),
  icon('berry', 'Berry', 'Resources'),
  icon('tree', 'Tree', 'Resources'),
  icon('mining', 'Mining', 'Resources'),
  icon('crypt', 'Crypt', 'Dungeons / danger'),
  icon('structure', 'Structure', 'Landmarks / special'),
  icon('farming_garden', 'Farming Garden', 'Resources'),
  icon('tar_pool', 'Tar Pool', 'Resources'),
  icon('tower', 'Tower', 'Landmarks / special'),
  icon('fortress', 'Fortress', 'Landmarks / special'),
  icon('ship', 'Ship', 'Base / travel'),
  icon('spawn', 'Spawn', 'Landmarks / special'),
  icon('maypole', 'Maypole', 'Landmarks / special'),
  icon('sap', 'Sap', 'Resources'),
  icon('signpost', 'Signpost', 'Navigation / status'),
  icon('vegvisir', 'Vegvisir', 'Landmarks / special'),
] as const;

export const MARKER_GROUPS: readonly MarkerGroup[] = [
  'Navigation / status',
  'Base / travel',
  'Resources',
  'Dungeons / danger',
  'Landmarks / special',
];

export function markerIconDefinition(markerType: string): MarkerIconDefinition {
  return MARKER_ICONS.find((iconDefinition) => iconDefinition.type === markerType) ??
    icon(markerType, markerType, 'Landmarks / special');
}

export function clampMarkerSizeScale(sizeScale: number): number {
  if (!Number.isFinite(sizeScale)) return 1;
  return Math.min(MARKER_MAX_SIZE_SCALE, Math.max(MARKER_MIN_SIZE_SCALE, sizeScale));
}

export function markerSizeAfterStep(sizeScale: number, direction: -1 | 1): number {
  return clampMarkerSizeScale(Math.round((sizeScale + direction * MARKER_SIZE_STEP) * 100) / 100);
}

/** 0° is north/up; positive values rotate clockwise. */
export function normaliseDirectionDegrees(direction: number): number {
  if (!Number.isFinite(direction)) return 0;
  return ((Math.round(direction) % 360) + 360) % 360;
}

export function vegvisirArrowVector(directionDegrees: number, radius: number): readonly [number, number] {
  const radians = (normaliseDirectionDegrees(directionDegrees) * Math.PI) / 180;
  return [Math.sin(radians) * radius, -Math.cos(radians) * radius];
}

export function normaliseMarkerCaption(value: string): string | null {
  const caption = value.trim();
  return caption.length === 0 ? null : caption;
}

/** Returns a complete, self-contained SVG suitable for Pixi Graphics.svg(). */
export function markerSvgMarkup(markerType: string, directionDegrees: number | null = null): string {
  const color = markerType === 'red_cross'
    ? MARKER_RED_CROSS_COLOR
    : markerType === 'green_tick'
      ? MARKER_GREEN_TICK_COLOR
      : MARKER_SYMBOL_COLOR;
  return `<svg viewBox="0 0 64 64" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">${markerSvgBody(markerType, directionDegrees)}</svg>`;
}

/** Draws the same canonical SVG used by the marker palette into Pixi. */
export function drawMarkerIcon(graphic: Graphics, markerType: string, directionDegrees: number | null): void {
  graphic.svg(markerSvgMarkup(markerType, directionDegrees));
}

function markerSvgBody(markerType: string, directionDegrees: number | null): string {
  switch (markerType) {
    case 'death_skull': return '<path d="M18 29c0-10 6-17 14-17s14 7 14 17v11l-5 5v7H23v-7l-5-5Z"/><circle cx="26" cy="30" r="3" fill="#403B34"/><circle cx="38" cy="30" r="3" fill="#403B34"/><path d="M29 40h6l-3 4Zm-4 8h14m-10 0v4m5-4v4"/>';
    case 'boss': return '<path d="M20 26 11 17l2 15 8 4c0 10 5 17 11 17s11-7 11-17l8-4 2-15-9 9"/><path d="M23 29c0-8 4-13 9-13s9 5 9 13v11l-5 6H28l-5-6Z"/><circle cx="27" cy="31" r="3" fill="#403B34"/><circle cx="37" cy="31" r="3" fill="#403B34"/><path d="m29 42 3 3 3-3m-7 8h8"/>';
    case 'trader': return '<path d="M20 27c0-9 5-15 12-15s12 6 12 15l-4 5H24Z"/><circle cx="32" cy="24" r="6"/><path d="M23 32c-4 3-6 8-6 16h30c0-8-2-13-6-16M27 48v-9h10v9"/><path d="M43 35c7 0 9 5 7 11l-4 4h-6l-2-7 5-8Z"/><circle cx="45" cy="42" r="2"/>';
    case 'pet': return '<path d="m18 20 8 4 6-8 6 8 8-4-2 13v12l-7 7H27l-7-7V33Z"/><path d="M24 30h16l-3 9H27Z"/><circle cx="27" cy="31" r="2" fill="#403B34"/><circle cx="37" cy="31" r="2" fill="#403B34"/><path d="M29 40h6m-3 0v4"/>';
    case 'home': return '<path d="m9 31 23-19 23 19v21H9Z"/><path d="M15 30h34M19 37h26M19 44h26M26 52V39h12v13"/><path d="M12 25h40"/>';
    case 'campfire': return '<path d="m17 48 30-12M17 36l30 12"/><path d="M32 12c9 9 8 18 0 29-8-11-9-20 0-29Z"/><path d="M32 25c4 5 3 9 0 13-3-4-4-8 0-13Z"/>';
    case 'circle': return '<circle cx="32" cy="32" r="11" fill="#403B34" stroke="none"/>';
    case 'red_cross': return '<path d="M17 17 47 47M47 17 17 47" stroke="#9A3F3C" stroke-width="8"/>';
    case 'green_tick': return '<path d="m14 33 12 12 25-27" stroke="#48744E" stroke-width="7"/>';
    case 'tent': return '<path d="m8 51 20-37 28 37Z"/><path d="m28 14 8 37M28 51V38l8 13"/>';
    case 'castle': return '<path d="M10 52V22h9v7h8v-7h10v7h8v-7h9v30Z"/><path d="M10 22V13h9v9m8 0v-9h10v9m8 0v-9h9v9M26 52V39h12v13M17 37h4m22 0h4"/>';
    case 'dragon_egg': return '<path d="M32 10c12 10 16 22 11 34-3 7-19 7-22 0C16 32 20 20 32 10Z"/><path d="m25 35 5-5 4 4 5-6M27 22l4 4 4-4"/>';
    case 'chest': return '<path d="M10 27h44v25H10Z"/><path d="M13 27c1-10 8-15 19-15s18 5 19 15M10 36h44M32 27v25"/><rect x="28" y="36" width="8" height="7" rx="1" fill="#403B34"/>';
    case 'portal': return '<circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="14"/><path d="m32 10 3 5m12 5-5 3m0 18 5 3m-12 5-3 5m-15-10-5-3m0-18-5-3m5-3 5-3"/>';
    case 'cave': return '<path d="M10 52V34c0-13 10-23 22-23s22 10 22 23v18Z"/><path d="M25 52V39c0-4 3-7 7-7s7 3 7 7v13"/>';
    case 'village': return '<path d="m7 51 12-17 12 17Z"/><path d="M17 51V39h5v12"/><path d="m23 51 13-24 15 24Z"/><path d="M34 51V37h6v14"/><path d="m8 34 10-13 10 13"/>';
    case 'berry': return '<path d="M32 14c-5 3-8 7-9 12m9-12c5 0 10 3 13 8"/><circle cx="22" cy="35" r="7"/><circle cx="35" cy="37" r="7"/><circle cx="29" cy="46" r="7"/>';
    case 'tree': return '<path d="m32 8-14 18h8L13 41h12l-8 11h30l-8-11h12L38 26h8Z"/><path d="M32 41v11"/>';
    case 'mining': return '<path d="m11 48 9-20 14-10 17 13-6 17Z"/><path d="M14 15 46 47M10 24l12-12 10 2m-6 6 6-6 15 0"/>';
    case 'crypt': return '<path d="M12 52V29c0-11 9-19 20-19s20 8 20 19v23Z"/><path d="M20 52V31c0-7 5-12 12-12s12 5 12 12v21"/><path d="m17 29 30 17m0-17L17 46"/><rect x="28" y="34" width="8" height="10" rx="2" fill="#403B34"/>';
    case 'structure': return '<path d="M10 52V28l14-11 8 6 12-11 10 12v28Z"/><path d="m10 28 14 5 8-10 12 7 10-6M20 52V39h9v13M42 52V43h7M36 18l-4 5 5 2"/>';
    case 'farming_garden': return '<path d="M9 13h46v39H9Z"/><path d="M17 46V25m10 21V25m10 21V25m10 21V25M13 31h38M13 39h38"/><path d="m17 25 3-5m7 5 3-5m7 5 3-5m7 5 3-5"/>';
    case 'tar_pool': return '<path d="M8 39c5-11 12-16 21-14 8-8 22-3 27 12-6 11-15 15-25 13-10 3-19-1-23-11Z"/><path d="M17 40c5-4 10-4 15-1m5 4c4-3 7-3 10-1" stroke-width="2.5"/>';
    case 'tower': return '<path d="M18 52 22 18h20l4 34Z"/><path d="M18 18h28l-4-8H22ZM26 28h4m8 0h-4m-8 10h4m8 0h-4M28 52V43h8v9"/>';
    case 'fortress': return '<path d="M7 52V25h8v7h8v-7h9v7h9v-7h8v7h8v20Z"/><path d="M7 25V14h8v11m8 0V14h9v11m9 0V14h8v11m8 0V14h8v11M26 52V39h12v13"/>';
    case 'ship': return '<path d="M8 42c9 9 39 9 48 0l-7 11H17Z"/><path d="M32 11v31M32 14l15 18H32Z"/><path d="M10 42c3-5 7-7 11-7m22 0c5 0 9 2 11 7M12 55c5 3 10 3 15 0 5 3 10 3 15 0 5 3 10 3 15 0"/>';
    case 'spawn': return '<ellipse cx="32" cy="40" rx="23" ry="10"/><path d="m13 40 2-20 7 4 2 16m6 0 1-25 7 0 1 25m5 0 3-19 6 3 1 16"/>';
    case 'maypole': return '<path d="M32 9v45M19 17h26M14 54h36"/><path d="m19 17 8 14m18-14-8 14M22 17l-5 7m25-7 5 7"/>';
    case 'sap': return '<path d="M20 12v40m-8-25h16M20 27l11 8"/><path d="M39 28c7 8 8 14 4 19-4 5-12 2-12-4 0-5 3-10 8-15Z"/><path d="M20 17c8 0 13 3 16 10"/>';
    case 'signpost': return '<path d="M32 9v46M21 55h22"/><path d="M32 16h20l-7-7m7 7-7 7H32M32 31H12l7-7m-7 7 7 7h13M32 43h18l-7-7m7 7-7 7H32"/>';
    case 'vegvisir': return `<path d="M12 14h40v30H12Z"/><path d="M18 44h28M22 14v-5h20v5M32 18a12 12 0 1 0 0 24 12 12 0 0 0 0-24Z"/>${vegvisirArrowPath(directionDegrees ?? 0)}`;
    default: return '<path d="M12 12h40v40H12Z"/><path d="M20 20h24v24H20Z"/>';
  }
}

function vegvisirArrowPath(directionDegrees: number): string {
  const [x, y] = vegvisirArrowVector(directionDegrees, 10);
  const baseX = -x * 0.44;
  const baseY = -y * 0.44;
  const sideX = -y * 0.34;
  const sideY = x * 0.34;
  return `<path d="M${format(32 + x)} ${format(32 + y)} L${format(32 + baseX + sideX)} ${format(32 + baseY + sideY)} L${format(32 + baseX - sideX)} ${format(32 + baseY - sideY)}Z" fill="${MARKER_SYMBOL_COLOR}" stroke="none"/>`;
}

function format(value: number): string {
  return value.toFixed(2);
}
