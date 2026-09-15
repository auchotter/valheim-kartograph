import { useEffect, useRef, useState } from 'react';
import type { Marker } from '../../../shared/domain';
import {
  markerIconDefinition,
  normaliseDirectionDegrees,
  normaliseMarkerCaption,
} from '../lib/markerIcons';

interface MarkerInspectorProps {
  marker: Marker;
  immersive: boolean;
  disabled: boolean;
  captionDraft: string | undefined;
  onCaptionDraftChange: (markerId: string, draft: string | null) => void;
  onUpdate: (marker: Marker) => Promise<boolean>;
  onDirectionPreview: (direction: number) => void;
  onDirectionCommit: () => void;
  onDelete: (markerId: string) => void;
}

export function MarkerInspector({
  marker,
  immersive,
  disabled,
  captionDraft,
  onCaptionDraftChange,
  onUpdate,
  onDirectionPreview,
  onDirectionCommit,
  onDelete,
}: MarkerInspectorProps) {
  const [direction, setDirection] = useState(marker.directionDegrees ?? 0);
  const editable = !disabled && marker.objectVersion > 0;
  const isVegvisir = marker.markerType === 'vegvisir';

  useEffect(() => {
    setDirection(marker.directionDegrees ?? 0);
  }, [marker.directionDegrees, marker.id]);

  const previewDirection = (nextDirection: number) => {
    const normalised = normaliseDirectionDegrees(nextDirection);
    setDirection(normalised);
    onDirectionPreview(normalised);
  };

  return (
    <section className="marker-inspector" aria-label="Selected marker">
      <header>
        <strong>{markerIconDefinition(marker.markerType).label}</strong>
      </header>
      <label>
        <span>Caption</span>
        <MarkerCaptionField
          marker={marker}
          disabled={!editable}
          captionDraft={captionDraft}
          onCaptionDraftChange={onCaptionDraftChange}
          onUpdate={onUpdate}
        />
      </label>
      {!immersive && isVegvisir && (
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
            onPointerUp={onDirectionCommit}
            onKeyUp={(event) => {
              if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
                onDirectionCommit();
              }
            }}
          />
        </label>
      )}
      {!immersive && (
        <button type="button" className="marker-inspector__delete" disabled={!editable} onClick={() => onDelete(marker.id)}>
          Delete marker
        </button>
      )}
    </section>
  );
}

export function MarkerCaptionField({
  marker,
  disabled,
  captionDraft,
  onCaptionDraftChange,
  onUpdate,
  className = 'marker-inspector__caption-input',
}: {
  marker: Marker;
  disabled: boolean;
  captionDraft: string | undefined;
  onCaptionDraftChange: (markerId: string, draft: string | null) => void;
  onUpdate: (marker: Marker) => Promise<boolean>;
  className?: string;
}) {
  const fieldRef = useRef<HTMLSpanElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const caption = captionDraft ?? marker.name ?? '';
  const captionRef = useRef(caption);
  const captionCommitInFlightRef = useRef(false);
  const editable = !disabled && marker.objectVersion > 0;

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
        fieldRef.current?.contains(event.target)
      ) {
        return;
      }
      // Capture-phase pointerdown commits before MapCanvas handles the map
      // interaction, preserving the existing click-away commit semantics.
      void commitCaption();
    };
    document.addEventListener('pointerdown', commitOutsideCaption, true);
    return () => document.removeEventListener('pointerdown', commitOutsideCaption, true);
  }, [commitCaption]);

  return (
    <span ref={fieldRef} className="marker-caption-field">
      <input
        ref={captionInputRef}
        className={className}
        value={caption}
        disabled={!editable}
        maxLength={500}
        aria-label="Marker caption"
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
            event.stopPropagation();
            cancelCaption();
            event.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}
