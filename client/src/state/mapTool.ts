export type MapTool = 'pan' | 'biome_brush' | 'eraser';

export function isBrushTool(tool: MapTool): tool is 'biome_brush' | 'eraser' {
  return tool === 'biome_brush' || tool === 'eraser';
}
