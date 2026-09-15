import { useEffect, useRef } from 'react';
import type { Marker } from '../../../shared/domain';
import { normaliseMarkerCaption } from '../lib/markerIcons';

export function MarkerCaptionField({
  marker,
  disabled,
  captionDraft,
  onCaptionDraftChange,
  onUpdate,
  className = 'marker-caption-field__input',
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
