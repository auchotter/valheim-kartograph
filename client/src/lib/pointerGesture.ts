import type { MapTool } from '../state/mapTool';

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
}): InitialPointerGesture {
  if (input.button === 1 || (input.button === 0 && (input.spaceHeld || input.tool === 'pan'))) {
    return 'pan';
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
    case 'select':
      return 'select';
    default:
      return 'none';
  }
}
