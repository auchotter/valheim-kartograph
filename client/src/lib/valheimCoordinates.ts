/** Horizontal coordinates reported by Valheim's F5 `pos` command. */
export interface ValheimCoordinate {
  x: number;
  z: number;
}

/** The app's 2D world coordinate, where +Y is screen-down in the map. */
export interface MapCoordinate {
  x: number;
  y: number;
}

/**
 * Valheim's positive Z axis is north. The map's positive Y axis points south
 * because screen Y increases downward, so Z is intentionally negated here.
 * One unit remains one metre; no scale conversion is applied.
 */
export function valheimToMapCoordinates(x: number, z: number): MapCoordinate {
  return { x, y: z === 0 ? 0 : -z };
}

export function mapToValheimCoordinates(x: number, y: number): ValheimCoordinate {
  return { x, z: y === 0 ? 0 : -y };
}

/** Parses a decimal coordinate without silently accepting blanks or garbage. */
export function parseValheimCoordinate(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
