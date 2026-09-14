import { useEffect, useRef, useState, type ReactNode } from 'react';
import { partitionHudItems, type HudControlGroup, type HudLayoutMode } from '../lib/hudLayout';

export interface ResponsiveOverflowItem {
  id: string;
  active?: boolean;
  render: (context: { inOverflow: boolean; closeOverflow: () => void }) => ReactNode;
}

interface ResponsiveOverflowBarProps {
  ariaLabel: string;
  className?: string;
  items: readonly ResponsiveOverflowItem[];
  mode: HudLayoutMode;
  group: HudControlGroup;
}

/**
 * One control definition, with fixed membership for each responsive mode.
 * Neither the current DOM width nor the open menu influences membership.
 */
export function ResponsiveOverflowBar({ ariaLabel, className = '', items, mode, group }: ResponsiveOverflowBarProps) {
  const overflowRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const partition = partitionHudItems(items, mode, group);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (overflowRef.current !== null && !overflowRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [mode]);

  const activeInOverflow = partition.overflow.some((item) => item.active);
  const closeOverflow = (): void => setOpen(false);

  return (
    <div className={`responsive-overflow ${className}`} role="group" aria-label={ariaLabel}>
      <div className="responsive-overflow__visible">
        {partition.visible.map((item) => <span key={item.id} className="responsive-overflow__item">{item.render({ inOverflow: false, closeOverflow })}</span>)}
      </div>

      {partition.overflow.length > 0 && (
        <div ref={overflowRef} className="responsive-overflow__menu">
          <button
            type="button"
            className={activeInOverflow ? 'responsive-overflow__toggle responsive-overflow__toggle--active' : 'responsive-overflow__toggle'}
            aria-label="More controls"
            aria-expanded={open}
            aria-haspopup="true"
            onClick={() => setOpen((current) => !current)}
          >
            ⋯
          </button>
          {open && (
            <div className="responsive-overflow__dropdown" aria-label={`${ariaLabel} overflow`}>
              {partition.overflow.map((item) => (
                <span key={item.id} className="responsive-overflow__dropdown-item">
                  {item.render({ inOverflow: true, closeOverflow })}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
