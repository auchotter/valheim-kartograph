import { useEffect, useRef, useState } from 'react';
import type { Marker } from '../../../shared/domain';
import {
  markerIconDefinition,
  markerSizeAfterStep,
  normaliseDirectionDegrees,
  normaliseMarkerCaption,
} from '../lib/markerIcons';
import { markerWithDirection } from '../lib/markerGeometry';

interface MarkerInspectorProps {
  marker: Marker;
  disabled: boolean;
  onUpdate: (marker: Marker) => void;
  onPreview: (marker: Marker | null) => void;
  onDelete: (markerId: string) => void;
}

export function MarkerInspector({ marker, disabled, onUpdate, onPreview, onDelete }: MarkerInspectorProps) {
  const [caption, setCaption] = useState(marker.name ?? '');
  const directionRef = useRef(marker.directionDegrees ?? 0);
  const [direction, setDirection] = useState(directionRef.current);
  const editable = !disabled && marker.objectVersion > 0;
  const isVegvisir = marker.markerType === 'vegvisir';

  useEffect(() => {
    setCaption(marker.name ?? '');
    directionRef.current = marker.directionDegrees ?? 0;
    setDirection(directionRef.current);
    onPreview(null);
  }, [marker.id, marker.name, marker.directionDegrees, onPreview]);

  const commitCaption = () => {
    const name = normaliseMarkerCaption(caption);
    if (name !== marker.name && editable) {
      onUpdate({ ...marker, name });
    }
  };

  const previewDirection = (nextDirection: number) => {
    const normalised = normaliseDirectionDegrees(nextDirection);
    directionRef.current = normalised;
    setDirection(normalised);
    onPreview(markerWithDirection(marker, normalised));
  };

  const commitDirection = () => {
    const draft = markerWithDirection(marker, directionRef.current);
    onPreview(null);
    if (editable && draft.directionDegrees !== marker.directionDegrees) {
      onUpdate(draft);
    }
  };

  const adjustSize = (step: -1 | 1) => {
    if (!editable) {
      return;
    }
    const sizeScale = markerSizeAfterStep(marker.sizeScale, step);
    if (sizeScale !== marker.sizeScale) {
      onUpdate({ ...marker, sizeScale });
    }
  };

  return (
    <section className="marker-inspector" aria-label="Selected marker">
      <header>
        <strong>{markerIconDefinition(marker.markerType).label}</strong>
      </header>
      <label>
        <span>Caption</span>
        <input
          value={caption}
          disabled={!editable}
          maxLength={500}
          onChange={(event) => setCaption(event.target.value)}
          onBlur={commitCaption}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitCaption();
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <div className="marker-inspector__row">
        <span>Size</span>
        <button type="button" disabled={!editable || marker.sizeScale <= 0.5} onClick={() => adjustSize(-1)} aria-label="Decrease marker size">
          −
        </button>
        <output>{marker.sizeScale.toFixed(2)}×</output>
        <button type="button" disabled={!editable || marker.sizeScale >= 3} onClick={() => adjustSize(1)} aria-label="Increase marker size">
          +
        </button>
      </div>
      {isVegvisir && (
        <label className="marker-inspector__direction">
          <span>Direction {direction}°</span>
          <input
            type="range"
            min="0"
            max="359"
            step="1"
            value={direction}
            disabled={!editable}
            onChange={(event) => previewDirection(Number(event.target.value))}
            onPointerUp={commitDirection}
            onKeyUp={(event) => {
              if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                commitDirection();
              }
            }}
          />
        </label>
      )}
      <button type="button" className="marker-inspector__delete" disabled={!editable} onClick={() => onDelete(marker.id)}>
        Delete marker
      </button>
    </section>
  );
}
