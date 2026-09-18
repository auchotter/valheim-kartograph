import type { Label, WorldPoint } from '../../../shared/domain';

export const LABEL_MIN_VISIBLE_ZOOM = 0.2;

export function labelZoomScale(currentZoom: number, referenceZoom: number): number {
  return currentZoom / referenceZoom;
}

/** The camera supplies currentZoom; this counter-scale leaves current/reference on screen. */
export function labelWorldScale(referenceZoom: number): number {
  return 1 / referenceZoom;
}

export function isLabelVisibleAtZoom(zoom: number): boolean {
  return zoom >= LABEL_MIN_VISIBLE_ZOOM;
}

/** Approximate Norse text bounds used consistently for selection and dragging. */
export function labelVisualSize(label: Pick<Label, 'text' | 'fontSize'>): { width: number; height: number } {
  return {
    width: Math.max(label.fontSize, label.text.length * label.fontSize * 0.62) + 4,
    height: label.fontSize * 1.3 + 4,
  };
}

export function hitTestLabel(labels: readonly Label[], point: WorldPoint, zoom: number): Label | null {
  if (!isLabelVisibleAtZoom(zoom)) return null;
  return [...labels]
    .filter((label) => label.deletedAt === null)
    .sort((left, right) => right.orderKey - left.orderKey)
    .find((label) => labelContainsPoint(label, point)) ?? null;
}

function labelContainsPoint(label: Label, point: WorldPoint): boolean {
  const { width, height } = labelVisualSize(label);
  const worldScale = labelWorldScale(label.referenceZoom);
  const angle = (label.rotationDegrees * Math.PI) / 180;
  const deltaX = (point[0] - label.x) / worldScale;
  const deltaY = (point[1] - label.y) / worldScale;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const localX = deltaX * cos - deltaY * sin;
  const localY = deltaX * sin + deltaY * cos;
  return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
}
