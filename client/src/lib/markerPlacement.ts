/** Marker placement is deliberately local UI state; it is never persisted. */
export function toggleArmedMarkerType(current: string | null, markerType: string): string | null {
  return current === markerType ? null : markerType;
}

/** Used by Select-mode hit testing, where a second click toggles selection. */
export function markerSelectionAfterClick(selectedMarkerId: string | null, clickedMarkerId: string): string | null {
  return selectedMarkerId === clickedMarkerId ? null : clickedMarkerId;
}

export interface MarkerInteractionState {
  armedMarkerType: string | null;
  selectedMarkerId: string | null;
}

export function clearMarkerInteraction(): MarkerInteractionState {
  return { armedMarkerType: null, selectedMarkerId: null };
}
