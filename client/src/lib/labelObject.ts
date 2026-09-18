import type { Id, Label } from '../../../shared/domain';
import { MapLayer } from '../../../shared/domain';

export const DEFAULT_LABEL_FONT_SIZE = 24;
export const MIN_LABEL_FONT_SIZE = 12;
export const MAX_LABEL_FONT_SIZE = 72;

export interface CompletedLabelGesture {
  id: Id;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  referenceZoom: number;
  rotationDegrees: number;
}

export function normaliseLabelText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normaliseLabelRotation(rotationDegrees: number): number {
  if (!Number.isFinite(rotationDegrees)) return 0;
  return ((Math.round(rotationDegrees) % 360) + 360) % 360;
}

export function createOptimisticLabel({
  id,
  mapId,
  x,
  y,
  text,
  fontSize,
  referenceZoom,
  rotationDegrees,
}: CompletedLabelGesture & { mapId: Id }): Label {
  const now = new Date().toISOString();
  return {
    id,
    mapId,
    objectType: 'label',
    layer: MapLayer.Labels,
    orderKey: Number.MAX_SAFE_INTEGER,
    objectVersion: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    minX: x,
    minY: y,
    maxX: x,
    maxY: y,
    x,
    y,
    text,
    fontSize,
    referenceZoom,
    rotationDegrees: normaliseLabelRotation(rotationDegrees),
  };
}
