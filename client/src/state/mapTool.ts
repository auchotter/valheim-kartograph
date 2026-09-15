export type MapTool = 'pan' | 'biome_brush' | 'eraser' | 'path' | 'marker' | 'text' | 'select';

export function isBrushTool(tool: MapTool): tool is 'biome_brush' | 'eraser' {
  return tool === 'biome_brush' || tool === 'eraser';
}
