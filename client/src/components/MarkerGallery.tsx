import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MARKER_ICONS, markerTextureUrl } from '../lib/markerIcons';

interface MarkerGalleryProps {
  open: boolean;
  anchorRef: { current: HTMLElement | null };
  armedMarkerType: string | null;
  onSelect: (markerType: string) => void;
  onClose: () => void;
}

/** A single, uncluttered icon gallery for the supplied marker PNG set. */
const GALLERY_VIEWPORT_MARGIN = 12;
const GALLERY_OFFSET = 4;

export function MarkerGallery({ open, anchorRef, armedMarkerType, onSelect, onClose }: MarkerGalleryProps) {
  const galleryRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({
    left: GALLERY_VIEWPORT_MARGIN,
    top: GALLERY_VIEWPORT_MARGIN,
  });

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    const positionGallery = () => {
      const anchor = anchorRef.current;
      const gallery = galleryRef.current;
      if (anchor === null || gallery === null) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const galleryRect = gallery.getBoundingClientRect();
      const rightEdge = Math.min(anchorRect.right, window.innerWidth - GALLERY_VIEWPORT_MARGIN);
      const left = Math.max(GALLERY_VIEWPORT_MARGIN, rightEdge - galleryRect.width);
      const maxTop = Math.max(
        GALLERY_VIEWPORT_MARGIN,
        window.innerHeight - galleryRect.height - GALLERY_VIEWPORT_MARGIN,
      );
      const top = Math.max(
        GALLERY_VIEWPORT_MARGIN,
        Math.min(anchorRect.bottom + GALLERY_OFFSET, maxTop),
      );

      setPosition({ left, top });
    };

    positionGallery();
    window.addEventListener('resize', positionGallery);
    window.addEventListener('scroll', positionGallery);
    return () => {
      window.removeEventListener('resize', positionGallery);
      window.removeEventListener('scroll', positionGallery);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeForOutsidePointer = (event: PointerEvent) => {
      if (galleryRef.current?.contains(event.target as Node)) {
        return;
      }
      // This is capture-phase so the outside click closes the gallery without
      // also reaching MapCanvas and placing a marker beneath it.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    document.addEventListener('pointerdown', closeForOutsidePointer, true);
    document.addEventListener('keydown', closeForEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeForOutsidePointer, true);
      document.removeEventListener('keydown', closeForEscape, true);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <section
      ref={galleryRef}
      className="marker-gallery"
      role="dialog"
      aria-label="Marker gallery"
      style={{ left: position.left, top: position.top }}
    >
      <div className="marker-gallery__grid">
        {MARKER_ICONS.map((icon) => {
          const selected = icon.type === armedMarkerType;
          return (
            <button
              key={icon.type}
              type="button"
              className={`immersive-wood-button marker-gallery__item${selected ? ' marker-gallery__item--active' : ''}`}
              aria-label={icon.label}
              aria-pressed={selected}
              aria-current={selected ? 'true' : undefined}
              title={icon.label}
              onClick={() => onSelect(icon.type)}
            >
              <img src={markerTextureUrl(icon.type)} alt="" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
