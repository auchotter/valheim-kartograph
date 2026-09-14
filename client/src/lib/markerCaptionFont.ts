export const MARKER_CAPTION_FONT_FAMILY = 'ValheimNorse';
export const MARKER_CAPTION_FONT_FALLBACK = 'Inter, ui-sans-serif, system-ui, sans-serif';

let markerCaptionFontLoad: Promise<boolean> | null = null;

/**
 * Starts one browser-managed load of the bundled @font-face. Pixi rebuilds
 * caption Text nodes once this resolves so fallback metrics never become
 * permanent.
 */
export function loadMarkerCaptionFont(): Promise<boolean> {
  if (markerCaptionFontLoad !== null) {
    return markerCaptionFontLoad;
  }
  if (typeof document === 'undefined' || document.fonts === undefined) {
    return Promise.resolve(false);
  }

  markerCaptionFontLoad = document.fonts
    .load(`12px "${MARKER_CAPTION_FONT_FAMILY}"`)
    .then(() => document.fonts.check(`12px "${MARKER_CAPTION_FONT_FAMILY}"`))
    .catch(() => false);
  return markerCaptionFontLoad;
}
