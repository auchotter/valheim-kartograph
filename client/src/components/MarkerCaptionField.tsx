import { useEffect, useRef } from 'react';
import type { Marker } from '../../../shared/domain';
import { normaliseMarkerCaption } from '../lib/markerIcons';

export function MarkerCaptionField({
  marker,
  disabled,
  captionDraft,
  onCaptionDraftChange,
  onUpdate,
  onConfirm,
  autoFocusRequested = false,
  onAutoFocusConsumed,
  className = 'marker-caption-field__input',
}: {
  marker: Marker;
  disabled: boolean;
  captionDraft: string | undefined;
  onCaptionDraftChange: (markerId: string, draft: string | null) => void;
  onUpdate: (marker: Marker) => Promise<boolean>;
  onConfirm: () => Promise<boolean>;
  /** A placement-only, one-shot request. Existing selection never sets it. */
  autoFocusRequested?: boolean;
  onAutoFocusConsumed?: (markerId: string) => void;
  className?: string;
}) {
  const fieldRef = useRef<HTMLSpanElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const caption = captionDraft ?? marker.name ?? '';
  const captionRef = useRef(caption);
  const hasCaptionDraftRef = useRef(captionDraft !== undefined);
  const captionCommitInFlightRef = useRef(false);
  const editable = !disabled && marker.objectVersion > 0;

  useEffect(() => {
    captionRef.current = caption;
  }, [caption]);

  useEffect(() => {
    hasCaptionDraftRef.current = captionDraft !== undefined;
  }, [captionDraft]);

  useEffect(() => {
    if (!autoFocusRequested || !editable) return;
    captionInputRef.current?.focus({ preventScroll: true });
    onAutoFocusConsumed?.(marker.id);
  }, [autoFocusRequested, editable, marker.id, onAutoFocusConsumed]);

  const commitCaption = async (): Promise<void> => {
    if (captionCommitInFlightRef.current) {
      return;
    }
    const name = normaliseMarkerCaption(captionRef.current);
    if (name === marker.name) {
      hasCaptionDraftRef.current = false;
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
      hasCaptionDraftRef.current = false;
      onCaptionDraftChange(marker.id, null);
    }
  };

  const cancelCaption = () => {
    captionRef.current = marker.name ?? '';
    hasCaptionDraftRef.current = false;
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
          hasCaptionDraftRef.current = true;
          onCaptionDraftChange(marker.id, event.target.value);
        }}
        onBlur={() => void commitCaption()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (event.nativeEvent.isComposing || captionCommitInFlightRef.current) return;
            captionCommitInFlightRef.current = true;
            void onConfirm().finally(() => { captionCommitInFlightRef.current = false; });
          } else if (event.key === 'Escape') {
            // A clean focused caption is not a transient editor state. Let
            // the canvas own that Escape so it can deselect and return to Pan.
            if (!hasCaptionDraftRef.current) return;
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
