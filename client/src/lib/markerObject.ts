import type { Id, Marker } from '../../../shared/domain';
import { MapLayer } from '../../../shared/domain';

export interface CompletedMarkerGesture {
  id: Id;
  markerType: string;
  x: number;
  y: number;
  directionDegrees: number | null;
}

export function createOptimisticMarker({
  id,
  mapId,
  markerType,
  x,
  y,
  directionDegrees,
}: {
  id: Id;
  mapId: Id;
  markerType: string;
  x: number;
  y: number;
  directionDegrees: number | null;
}): Marker {
  const now = new Date().toISOString();
  return {
    id,
    mapId,
    objectType: 'marker',
    layer: MapLayer.Markers,
    orderKey: Number.MAX_SAFE_INTEGER,
    objectVersion: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    minX: x,
    minY: y,
    maxX: x,
    maxY: y,
    markerType,
    x,
    y,
    name: null,
    note: null,
    sizeScale: 1,
    directionDegrees,
  };
}
