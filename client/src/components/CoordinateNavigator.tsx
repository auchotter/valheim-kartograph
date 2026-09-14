import { useEffect, useRef, useState } from 'react';
import type { MapCoordinate } from '../lib/valheimCoordinates';
import { parseValheimCoordinate, valheimToMapCoordinates } from '../lib/valheimCoordinates';

interface CoordinateNavigatorProps {
  onGo: (coordinate: MapCoordinate) => void;
  onComplete?: () => void;
}

export function CoordinateNavigator({ onGo, onComplete }: CoordinateNavigatorProps) {
  const [open, setOpen] = useState(false);
  const [x, setX] = useState('');
  const [z, setZ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setError(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        setError(null);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const submit = (): void => {
    const parsedX = parseValheimCoordinate(x);
    const parsedZ = parseValheimCoordinate(z);
    if (parsedX === null || parsedZ === null) {
      setError('Enter finite numeric X and Z coordinates.');
      return;
    }
    onGo(valheimToMapCoordinates(parsedX, parsedZ));
    setOpen(false);
    setError(null);
    onComplete?.();
  };

  return (
    <div ref={rootRef} className="coordinate-navigator">
      <button
        className="utility-control"
        type="button"
        aria-label="Go to Valheim coordinates. In-game, enable the console, press F5, type `pos`, and use the displayed X and Z coordinates"
        title="Go to Valheim coordinates. In-game, enable the console, press F5, type `pos`, and use the displayed X and Z coordinates"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
      >
        Add coordinate
      </button>
      {open && (
        <form
          className="coordinate-navigator__panel"
          aria-label="Go to Valheim coordinate"
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
              type="text"
              inputMode="decimal"
              value={z}
              onChange={(event) => setZ(event.target.value)}
              aria-label="Valheim Z coordinate"
            />
          </label>
          {error !== null && <span className="coordinate-navigator__error" role="alert">{error}</span>}
          <footer>
            <button type="button" onClick={() => { setOpen(false); setError(null); onComplete?.(); }}>Cancel</button>
            <button type="submit">Go</button>
          </footer>
        </form>
      )}
    </div>
  );
}
