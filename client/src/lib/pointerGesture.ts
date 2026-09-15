import type { MapTool } from '../state/mapTool';

/** Shared pointer movement threshold for distinguishing a click from a drag. */
export const OBJECT_DRAG_THRESHOLD_PX = 4;

export type InitialPointerGesture =
  | 'pan'
  | 'biome-draw'
  | 'erase'
  | 'path-draw'
  | 'marker-place'
  | 'select'
  | 'none';

/**
 * Decides the gesture exactly once at pointerdown. Navigation has priority
 * over every editing tool so later pointer events cannot reinterpret a pan as
 * a draw.
 */
export function initialPointerGesture(input: {
  button: number;
  spaceHeld: boolean;
  tool: MapTool;
  markerPlacementArmed: boolean;
  pathCreationArmed: boolean;
  panObjectInteraction?: boolean;
}): InitialPointerGesture {
  if (input.button === 1 || (input.button === 0 && input.spaceHeld)) {
    return 'pan';
  }
  if (input.button === 0 && input.tool === 'pan') {
    return input.panObjectInteraction ? 'select' : 'pan';
  }
  if (input.button !== 0) {
    return 'none';
  }
  switch (input.tool) {
    case 'biome_brush':
      return 'biome-draw';
    case 'eraser':
      return 'erase';
    case 'path':
      return input.pathCreationArmed ? 'path-draw' : 'select';
    case 'marker':
      return input.markerPlacementArmed ? 'marker-place' : 'select';
    case 'text':
    case 'select':
      return 'select';
    default:
      return 'none';
  }
}

/** Whether an empty left interaction in Pan + Protect-off should clear selection. */
export function shouldClearPanSelection(input: {
  tool: MapTool;
  protectEnabled: boolean;
  button: number;
  spaceHeld: boolean;
  objectHit: boolean;
}): boolean {
  return input.tool === 'pan' && !input.protectEnabled && (input.button === 0 || input.button === 1) && !input.spaceHeld && !input.objectHit;
}
