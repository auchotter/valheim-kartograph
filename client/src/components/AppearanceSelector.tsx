import type { MapAppearance } from '../lib/mapAppearance';

interface AppearanceSelectorProps {
  mode: MapAppearance;
  onChange: (mode: MapAppearance) => void;
}

export function AppearanceSelector({ mode, onChange }: AppearanceSelectorProps) {
  return (
    <label className="appearance-selector">
      <span className="appearance-selector__label">Map appearance</span>
      <select
        aria-label="Map appearance"
        value={mode}
        onChange={(event) => onChange(event.target.value as MapAppearance)}
      >
        <option value="modern">Modern</option>
        <option value="immersive">Immersive (Beta)</option>
      </select>
    </label>
  );
}
