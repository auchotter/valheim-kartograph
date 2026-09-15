import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MapCoordinate } from '../lib/valheimCoordinates';
import { parseValheimCoordinate, valheimToMapCoordinates } from '../lib/valheimCoordinates';

interface CoordinateNavigatorProps {
  anchorRect: DOMRectReadOnly | null;
  onClose: () => void;
  onGo: (coordinate: MapCoordinate) => void;
  open: boolean;
}

interface PanelPosition {
  left: number;
  top: number;
}

const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 8;

export function CoordinateNavigator({ anchorRect, onClose, onGo, open }: CoordinateNavigatorProps) {
  const [x, setX] = useState('');
  const [z, setZ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const panelRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setPosition(null);
      return undefined;
    }
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, open]);

  useLayoutEffect(() => {
    if (!open || anchorRect === null || panelRef.current === null) {
      return undefined;
    }

    const positionPanel = (): void => {
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const { width, height } = panel.getBoundingClientRect();
      const maximumLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
      const left = Math.min(Math.max(VIEWPORT_MARGIN, anchorRect.right - width), maximumLeft);
      const below = anchorRect.bottom + ANCHOR_GAP;
      const above = anchorRect.top - height - ANCHOR_GAP;
      const maximumTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
      const top = below + height <= window.innerHeight - VIEWPORT_MARGIN
        ? below
        : Math.min(Math.max(VIEWPORT_MARGIN, above), maximumTop);
      setPosition({ left, top });
    };

    positionPanel();
    window.addEventListener('resize', positionPanel);
    return () => window.removeEventListener('resize', positionPanel);
  }, [anchorRect, open]);

  const submit = (): void => {
    const parsedX = parseValheimCoordinate(x);
    const parsedZ = parseValheimCoordinate(z);
    if (parsedX === null || parsedZ === null) {
      setError('Enter finite numeric X and Z coordinates.');
      return;
    }
    onGo(valheimToMapCoordinates(parsedX, parsedZ));
    setError(null);
    onClose();
  };

  if (!open || anchorRect === null) {
    return null;
  }

  return (
    <form
      ref={panelRef}
      className="coordinate-navigator__panel coordinate-navigator__panel--overlay"
      aria-label="Go to Valheim coordinate"
      style={{ left: position?.left ?? VIEWPORT_MARGIN, top: position?.top ?? VIEWPORT_MARGIN }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <strong>Valheim coordinate</strong>
      <span className="coordinate-navigator__hint">F5 → pos</span>
      <label>
        <span>X</span>
        <input
          autoFocus
          className="immersive-recessed-field"
          type="text"
          inputMode="decimal"
          value={x}
          onChange={(event) => setX(event.target.value)}
          aria-label="Valheim X coordinate"
        />
      </label>
      <label>
        <span>Z</span>
        <input
          className="immersive-recessed-field"
          type="text"
          inputMode="decimal"
          value={z}
          onChange={(event) => setZ(event.target.value)}
          aria-label="Valheim Z coordinate"
        />
      </label>
      {error !== null && <span className="coordinate-navigator__error" role="alert">{error}</span>}
      <footer>
        <button type="button" className="immersive-wood-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="immersive-wood-button">Go</button>
      </footer>
    </form>
  );
}
