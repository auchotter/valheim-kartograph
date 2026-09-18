/** Local view opacity, represented as a continuous value from 0 to 1. */
export type PathOpacity = number;

export function clampPathOpacity(opacity: number): PathOpacity {
  return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
}
