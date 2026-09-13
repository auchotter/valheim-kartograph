import { MARKER_GROUPS, MARKER_ICONS, markerSvgMarkup, type MarkerIconDefinition } from '../lib/markerIcons';

interface MarkerPaletteProps {
  armedMarkerType: string | null;
  onMarkerTypeChange: (markerType: string) => void;
}

export function MarkerPalette({ armedMarkerType, onMarkerTypeChange }: MarkerPaletteProps) {
  return (
    <section className="marker-palette" aria-label="Marker palette">
      <header>
        <strong>Markers</strong>
        <span>{armedMarkerType === null ? 'Choose an icon to arm one placement.' : 'Armed for one placement.'}</span>
      </header>
      <div className="marker-palette__groups">
        {MARKER_GROUPS.map((group) => {
          const icons = MARKER_ICONS.filter((icon) => icon.group === group);
          return (
            <section key={group} className="marker-palette__group" aria-label={group}>
              <h2>{group}</h2>
              <div className="marker-palette__items">
                {icons.map((icon) => (
                  <button
                    key={icon.type}
                    type="button"
                    className={icon.type === armedMarkerType ? 'marker-palette__item marker-palette__item--active' : 'marker-palette__item'}
                    aria-pressed={icon.type === armedMarkerType}
                    onClick={() => onMarkerTypeChange(icon.type)}
                  >
                    <MarkerIconPreview icon={icon} />
                    <span className="marker-palette__label">{icon.label}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function MarkerIconPreview({ icon }: { icon: MarkerIconDefinition }) {
  return (
    <span
      className="marker-palette__icon"
      aria-hidden="true"
      // All markup is static, project-owned vector data from markerIcons.ts.
      dangerouslySetInnerHTML={{ __html: markerSvgMarkup(icon.type) }}
    />
  );
}
