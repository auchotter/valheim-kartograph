import type { Biome } from '../../../shared/domain';
import { BIOMES, biomeStyle } from '../lib/biomeStyles';
import type { MapTool } from '../state/mapTool';

interface MapToolbarProps {
  tool: MapTool;
  biome: Biome;
  brushWidth: number;
  onToolChange: (tool: MapTool) => void;
  onBiomeChange: (biome: Biome) => void;
  onBrushWidthChange: (width: number) => void;
}

export function MapToolbar({
  tool,
  biome,
  brushWidth,
  onToolChange,
  onBiomeChange,
  onBrushWidthChange,
}: MapToolbarProps) {
  return (
    <section className="map-toolbar" aria-label="Map drawing tools">
      <div className="map-toolbar__tools" role="group" aria-label="Active tool">
        <ToolButton active={tool === 'pan'} label="Pan" shortcut="H" onClick={() => onToolChange('pan')} />
        <ToolButton
          active={tool === 'biome_brush'}
          label="Biome Brush"
          shortcut="B"
          onClick={() => onToolChange('biome_brush')}
        />
        <ToolButton active={tool === 'eraser'} label="Eraser" shortcut="E" onClick={() => onToolChange('eraser')} />
      </div>

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
    </section>
  );
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
