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
  captionDraft: string | undefined;
  onCaptionDraftChange: (markerId: string, draft: string | null) => void;
  onUpdate: (marker: Marker) => Promise<boolean>;
  onPreview: (marker: Marker | null) => void;
  onDelete: (markerId: string) => void;
}

export function MarkerInspector({
  marker,
  disabled,
  captionDraft,
  onCaptionDraftChange,
  onUpdate,
  onPreview,
  onDelete,
}: MarkerInspectorProps) {
  const inspectorRef = useRef<HTMLElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const caption = captionDraft ?? marker.name ?? '';
  const captionRef = useRef(caption);
  const captionCommitInFlightRef = useRef(false);
  const directionRef = useRef(marker.directionDegrees ?? 0);
  const [direction, setDirection] = useState(directionRef.current);
  const editable = !disabled && marker.objectVersion > 0;
  const isVegvisir = marker.markerType === 'vegvisir';

  useEffect(() => {
    directionRef.current = marker.directionDegrees ?? 0;
    setDirection(directionRef.current);
    onPreview(null);
  }, [marker.id, marker.name, marker.directionDegrees, onPreview]);

  useEffect(() => {
    captionRef.current = caption;
  }, [caption]);

  const commitCaption = async (): Promise<void> => {
    if (captionCommitInFlightRef.current) {
      return;
    }
    const name = normaliseMarkerCaption(captionRef.current);
    if (name === marker.name) {
      onCaptionDraftChange(marker.id, null);
      return;
    }
    if (!editable) {
      return;
    }

    captionCommitInFlightRef.current = true;
    const saved = await onUpdate({ ...marker, name });
    captionCommitInFlightRef.current = false;
    if (saved) {
      onCaptionDraftChange(marker.id, null);
    }
  };

  const cancelCaption = () => {
    captionRef.current = marker.name ?? '';
    onCaptionDraftChange(marker.id, null);
  };

  useEffect(() => {
    const commitOutsideCaption = (event: PointerEvent) => {
      if (
        document.activeElement !== captionInputRef.current ||
        !(event.target instanceof Node) ||
        inspectorRef.current?.contains(event.target)
      ) {
        return;
      }
      // Capture-phase pointerdown commits before MapCanvas handles a marker,
      // path, or empty-map interaction, so that original interaction continues.
      void commitCaption();
    };
    document.addEventListener('pointerdown', commitOutsideCaption, true);
    return () => document.removeEventListener('pointerdown', commitOutsideCaption, true);
  }, [commitCaption]);

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
      void onUpdate(draft);
    }
  };

  const adjustSize = (step: -1 | 1) => {
    if (!editable) {
      return;
    }
    const sizeScale = markerSizeAfterStep(marker.sizeScale, step);
    if (sizeScale !== marker.sizeScale) {
      void onUpdate({ ...marker, sizeScale });
    }
  };

  return (
    <section ref={inspectorRef} className="marker-inspector" aria-label="Selected marker">
      <header>
        <strong>{markerIconDefinition(marker.markerType).label}</strong>
      </header>
      <label>
        <span>Caption</span>
        <input
          ref={captionInputRef}
          className="marker-inspector__caption-input"
          value={caption}
          disabled={!editable}
          maxLength={500}
          onChange={(event) => {
            captionRef.current = event.target.value;
            onCaptionDraftChange(marker.id, event.target.value);
          }}
          onBlur={() => void commitCaption()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commitCaption();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelCaption();
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
