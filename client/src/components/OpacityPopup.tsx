import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface OpacityPopupProps {
  open: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  anchorLayout: string;
  markerOpacity: number;
  pathOpacity: number;
  textOpacity: number;
  onMarkerOpacityChange: (value: number) => void;
  onPathOpacityChange: (value: number) => void;
  onTextOpacityChange: (value: number) => void;
  onClose: () => void;
}

export function OpacityPopup({
  open,
  anchorRef,
  anchorLayout,
  markerOpacity,
  pathOpacity,
  textOpacity,
  onMarkerOpacityChange,
  onPathOpacityChange,
  onTextOpacityChange,
  onClose,
}: OpacityPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 22, top: 22 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const popup = popupRef.current?.getBoundingClientRect();
      if (!anchor || !popup) return;
      setPosition({
        left: Math.max(22, Math.min(anchor.left, window.innerWidth - popup.width - 22)),
        top: Math.max(22, Math.min(anchor.bottom + 4, window.innerHeight - popup.height - 22)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, anchorLayout]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) return;
      if (!popupRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open) return null;

  const row = (label: string, ariaLabel: string, value: number, onChange: (value: number) => void) => (
    <label className="opacity-popup__row">
      <span>{label}</span>
      <input
        className="biome-brush-controls__slider opacity-popup__slider"
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(value * 100)}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.currentTarget.value) / 100)}
      />
    </label>
  );

  return (
    <div
      ref={popupRef}
      className="contextual-picker__popup opacity-popup"
      style={position}
      role="dialog"
      aria-label="Opacity controls"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="opacity-popup__content">
        {row('MARKERS', 'Marker opacity', markerOpacity, onMarkerOpacityChange)}
        {row('PATHS', 'Path opacity', pathOpacity, onPathOpacityChange)}
        {row('TEXT', 'Text opacity', textOpacity, onTextOpacityChange)}
      </div>
    </div>
  );
}
