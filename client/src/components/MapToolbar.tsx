import type { Biome, PathGeometryType } from '../../../shared/domain';
import { BIOMES, biomeStyle } from '../lib/biomeStyles';
import type { MapTool } from '../state/mapTool';
import { ResponsiveOverflowBar, type ResponsiveOverflowItem } from './ResponsiveOverflowBar';
import type { HudLayoutMode } from '../lib/hudLayout';

interface MapToolbarProps {
  layoutMode: HudLayoutMode;
  tool: MapTool;
  biome: Biome;
  brushWidth: number;
  pathGeometryType: PathGeometryType;
  hasSelectedPath: boolean;
  selectedPathPending: boolean;
  onToolChange: (tool: MapTool) => void;
  onBiomeChange: (biome: Biome) => void;
  onBrushWidthChange: (width: number) => void;
  onPathGeometryTypeChange: (geometryType: PathGeometryType) => void;
  onDeleteSelectedPath: () => void;
}

export function MapToolbar({
  layoutMode,
  tool,
  biome,
  brushWidth,
  pathGeometryType,
  hasSelectedPath,
  selectedPathPending,
  onToolChange,
  onBiomeChange,
  onBrushWidthChange,
  onPathGeometryTypeChange,
  onDeleteSelectedPath,
}: MapToolbarProps) {
  const showsBrushControls = tool === 'biome_brush' || tool === 'eraser';
  const toolItems: ResponsiveOverflowItem[] = [
    toolItem('pan', 'Pan', 'H'),
    toolItem('biome_brush', 'Biome Brush', 'B'),
    toolItem('eraser', 'Eraser', 'E'),
    toolItem('path', 'Path', 'P'),
    toolItem('marker', 'Marker', 'M'),
    toolItem('select', 'Select', 'V'),
  ].map((item) => ({
    ...item,
    active: tool === item.tool,
    render: ({ closeOverflow }) => (
      <ToolButton active={tool === item.tool} label={item.label} shortcut={item.shortcut} onClick={() => { onToolChange(item.tool); closeOverflow(); }} />
    ),
  }));

  return (
    <section className="map-toolbar" aria-label="Map drawing tools">
      <ResponsiveOverflowBar ariaLabel="Active tool" className="map-toolbar__tools" items={toolItems} mode={layoutMode} group="tools" />

      {tool === 'path' && (
        <label className="map-toolbar__field">
          <span>Mode</span>
          <select
            value={pathGeometryType}
            aria-label="Path drawing mode"
            onChange={(event) => {
              onPathGeometryTypeChange(event.target.value as PathGeometryType);
              event.currentTarget.blur();
            }}
          >
            <option value="freehand">Freehand</option>
            <option value="straight">Straight</option>
            <option value="curve">Curve</option>
          </select>
        </label>
      )}

      {showsBrushControls && (
        <>
          <label className="map-toolbar__field">
            <span>Biome</span>
            <select
              value={biome}
              disabled={tool === 'eraser'}
              onChange={(event) => {
                onBiomeChange(event.target.value as Biome);
                // A chosen biome is an immediate action, not an editing session. Releasing
                // focus returns H/B/E and Space-temporary-pan to the map as expected.
                event.currentTarget.blur();
              }}
            >
              {BIOMES.map((option) => (
                <option key={option} value={option}>
                  {biomeStyle(option).label}
                </option>
              ))}
            </select>
          </label>

          <label className="map-toolbar__field map-toolbar__size">
            <span>Size {brushWidth}</span>
            <input
              type="range"
              min="20"
              max="500"
              step="10"
              value={brushWidth}
              aria-label="Brush width in world units"
              onChange={(event) => onBrushWidthChange(Number(event.target.value))}
            />
          </label>
        </>
      )}

      {hasSelectedPath && (
        <button type="button" className="map-toolbar__delete" disabled={selectedPathPending} onClick={onDeleteSelectedPath}>
          Delete path
        </button>
      )}
    </section>
  );
}

function toolItem(tool: MapTool, label: string, shortcut: string) {
  return { id: tool, tool, label, shortcut };
}

function ToolButton({
  active,
  label,
  shortcut,
  onClick,
}: {
  active: boolean;
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? 'map-toolbar__tool map-toolbar__tool--active' : 'map-toolbar__tool'}
      aria-pressed={active}
      onClick={onClick}
    >
      {label} <kbd>{shortcut}</kbd>
    </button>
  );
}
