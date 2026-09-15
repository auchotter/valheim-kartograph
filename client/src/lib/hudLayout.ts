export type HudLayoutMode = 'wide' | 'medium' | 'narrow';
export type HudControlGroup = 'utility' | 'tools';

// A 508px tool card centred at 50vw needs room for the full utility card on
// its left. Below this point, the medium row-two layout prevents collision.
export const HUD_WIDE_MIN_PX = 1920;
export const HUD_MEDIUM_MIN_PX = 800;
export const HUD_WIDE_QUERY = `(min-width: ${HUD_WIDE_MIN_PX}px)`;
export const HUD_MEDIUM_QUERY = `(min-width: ${HUD_MEDIUM_MIN_PX}px)`;

const MEDIUM_UTILITY_IDS = new Set(['map-library', 'reset-view', 'zoom-to-one', 'undo', 'redo', 'grid', 'paths', 'protect']);
const NARROW_UTILITY_IDS = new Set(['map-library', 'undo', 'paths', 'protect']);
const NARROW_TOOL_IDS = new Set(['pan', 'path', 'select']);

export function hudLayoutMode(wideMatches: boolean, mediumMatches: boolean): HudLayoutMode {
  return wideMatches ? 'wide' : mediumMatches ? 'medium' : 'narrow';
}

/** Fixed membership only; original order and the original action objects survive. */
export function partitionHudItems<T extends { id: string }>(
  items: readonly T[], mode: HudLayoutMode, group: HudControlGroup,
): { visible: T[]; overflow: T[] } {
  if (mode === 'wide' || (mode === 'medium' && group === 'tools')) {
    return { visible: [...items], overflow: [] };
  }
  const visibleIds = group === 'tools' ? NARROW_TOOL_IDS
    : mode === 'medium' ? MEDIUM_UTILITY_IDS : NARROW_UTILITY_IDS;
  return {
    visible: items.filter((item) => visibleIds.has(item.id)),
    overflow: items.filter((item) => !visibleIds.has(item.id)),
  };
}
