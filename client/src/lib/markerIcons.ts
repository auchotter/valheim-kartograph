export const MARKER_ICON_VIEWBOX = 64;
export const MARKER_BASE_SIZE_CSS = 32;
export const MARKER_MIN_SIZE_SCALE = 0.5;
export const MARKER_MAX_SIZE_SCALE = 3;

export interface MarkerIconDefinition {
  type: string;
  label: string;
  asset: string;
  directionalAsset?: string;
}

const icon = (type: string, label: string, asset: string, directionalAsset?: string): MarkerIconDefinition => ({
  type,
  label,
  asset,
  directionalAsset,
});

/**
 * The sole selectable marker catalogue. The ordering deliberately follows the
 * user-authored PNG sequence in client/public/markers and has no categories.
 */
export const MARKER_ICONS: readonly MarkerIconDefinition[] = [
  icon('home', 'Home', '1-Home.png'),
  icon('chest', 'Chest', '2-Chest.png'),
  icon('campfire', 'Campfire', '3-Campfire.png'),
  icon('mining', 'Mining', '4-Mining.png'),
  icon('trade', 'Trade', '5-Trader.png'),
  icon('signpost', 'Signpost', '6-Signpost.png'),
  icon('ship', 'Ship', '7-Ship.png'),
  icon('portal', 'Portal', '8-Portal.png'),
  icon('cave-1', 'Cave 1', '9-Cave.png'),
  icon('cave-2', 'Cave 2', '10-Cave.png'),
  icon('fortress', 'Fortress', '11-Fortress.png'),
  icon('tower', 'Tower', '12-Tower.png'),
  icon('crypt', 'Crypt', '13-Crypt.png'),
  icon('castle', 'Castle', '14-Castle.png'),
  icon('potion', 'Potion', '14b-Potion.png'),
  icon('egg', 'Egg', '15-Egg.png'),
  icon('farm', 'Farm', '16-Farm.png'),
  icon('berry', 'Berry', '17-Berry.png'),
  icon('tree-1', 'Tree 1', '18-Tree.png'),
  icon('tree-2', 'Tree 2', '19-Tree.png'),
  icon('boar', 'Boar', '20-Boar.png'),
  icon('chicken', 'Chicken', '21-Chicken.png'),
  icon('wolf', 'Wolf', '22-Wolf.png'),
  icon('sap', 'Sap', '26-Sap.png'),
  icon('tar', 'Tar', '27-Tar.png'),
  icon('vegvisir', 'Vegvisir', '28-Vergvisir-1.png', '28-Vergvisir-2.png'),
  icon('death', 'Death', '29-Death.png'),
  icon('boss-1', 'Boss 1', '30-Boss.png'),
  icon('boss-2', 'Boss 2', '31-Boss.png'),
  icon('helmet', 'Helmet', '32-Helmet.png'),
  icon('spawn', 'Spawn', '33-Spawn.png'),
  icon('target', 'Target', '34-Target.png'),
  icon('pin', 'Pin', '35-Pin.png'),
  icon('positive', 'Positive', '36-Positive.png'),
  icon('negative', 'Negative', '37-Negative.png'),
] as const;

const iconsByType = new Map(MARKER_ICONS.map((definition) => [definition.type, definition]));

// These definitions remain render-only compatibility entries for markers
// already stored on maps. They are intentionally excluded from MARKER_ICONS,
// so they cannot appear in the gallery or be newly placed.
const legacyIconsByType = new Map([
  ['lox', icon('lox', 'Lox', '23-Lox.png')],
  ['askvin', icon('askvin', 'Askvin', '24-Askvin.png')],
  ['moose', icon('moose', 'Moose', '25-Moose.png')],
]);

// Old saved map objects retain their historical type strings. They are never
// presented as new-gallery choices, but map to the closest supplied artwork.
const LEGACY_TYPE_ALIASES: Readonly<Record<string, string>> = {
  death_skull: 'death',
  boss: 'boss-1',
  trader: 'trade',
  pet: 'wolf',
  circle: 'target',
  red_cross: 'negative',
  green_tick: 'positive',
  tent: 'farm',
  dragon_egg: 'egg',
  cave: 'cave-1',
  village: 'fortress',
  tree: 'tree-1',
  structure: 'castle',
  farming_garden: 'farm',
  tar_pool: 'tar',
  maypole: 'signpost',
};

const FALLBACK_MARKER_ICON = iconsByType.get('pin')!;

export function markerIconDefinition(markerType: string): MarkerIconDefinition {
  const resolvedType = LEGACY_TYPE_ALIASES[markerType] ?? markerType;
  return iconsByType.get(resolvedType) ?? legacyIconsByType.get(resolvedType) ?? FALLBACK_MARKER_ICON;
}

export function markerTextureUrl(markerType: string, directional = false): string {
  const definition = markerIconDefinition(markerType);
  const asset = directional && definition.directionalAsset !== undefined
    ? definition.directionalAsset
    : definition.asset;
  return `/markers/${asset}`;
}

export function isVegvisirMarker(markerType: string): boolean {
  return markerType === 'vegvisir';
}

export function clampMarkerSizeScale(sizeScale: number): number {
  if (!Number.isFinite(sizeScale)) return 1;
  return Math.min(MARKER_MAX_SIZE_SCALE, Math.max(MARKER_MIN_SIZE_SCALE, sizeScale));
}

/** 0° is north/up; positive values rotate clockwise. */
export function normaliseDirectionDegrees(direction: number): number {
  if (!Number.isFinite(direction)) return 0;
  return ((Math.round(direction) % 360) + 360) % 360;
}

export function normaliseMarkerCaption(value: string): string | null {
  const caption = value.trim();
  return caption.length === 0 ? null : caption;
}
