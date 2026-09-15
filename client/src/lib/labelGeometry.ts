import type { Label, WorldPoint } from '../../../shared/domain';
import { markerRootWorldScale } from './markerGeometry';

/** Approximate Norse text bounds used consistently for selection and dragging. */
export function labelVisualSize(label: Pick<Label, 'text' | 'fontSize'>): { width: number; height: number } {
  return {
    width: Math.max(label.fontSize, label.text.length * label.fontSize * 0.62) + 4,
    height: label.fontSize * 1.3 + 4,
  };
}

export function hitTestLabel(labels: readonly Label[], point: WorldPoint, zoom: number): Label | null {
  const inverseZoom = markerRootWorldScale(zoom);
  return [...labels]
    .filter((label) => label.deletedAt === null)
    .sort((left, right) => right.orderKey - left.orderKey)
    .find((label) => labelContainsPoint(label, point, inverseZoom)) ?? null;
}

function labelContainsPoint(label: Label, point: WorldPoint, inverseZoom: number): boolean {
  const { width, height } = labelVisualSize(label);
  const angle = (label.rotationDegrees * Math.PI) / 180;
  const deltaX = (point[0] - label.x) / inverseZoom;
  const deltaY = (point[1] - label.y) / inverseZoom;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const localX = deltaX * cos - deltaY * sin;
  const localY = deltaX * sin + deltaY * cos;
  return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
}
