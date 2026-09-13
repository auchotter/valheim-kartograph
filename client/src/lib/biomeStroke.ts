import type { Biome, BiomeStroke, Id, WorldPoint } from '../../../shared/domain';
import { MapLayer } from '../../../shared/domain';
import { strokeBoundingBox } from './strokeGeometry';

export interface CompletedBrushGesture {
  mode: 'paint' | 'erase';
  biome: Biome | null;
  brushWidth: number;
  points: WorldPoint[];
}

interface CreateOptimisticBiomeStrokeOptions extends CompletedBrushGesture {
  mapId: Id;
  id: Id;
}

/** A visual placeholder only; the API response replaces all authoritative fields. */
export function createOptimisticBiomeStroke({
  mapId,
  id,
  mode,
  biome,
  brushWidth,
  points,
}: CreateOptimisticBiomeStrokeOptions): BiomeStroke {
  if (points.length === 0) {
    throw new Error('Cannot create a biome stroke without points.');
  }

  if ((mode === 'paint' && biome === null) || (mode === 'erase' && biome !== null)) {
    throw new Error('Biome stroke mode and biome value are incompatible.');
  }

  const now = new Date().toISOString();
  const base = {
    id,
    mapId,
    objectType: 'biome_stroke' as const,
    layer: MapLayer.Terrain as MapLayer.Terrain,
    orderKey: Number.MAX_SAFE_INTEGER,
    objectVersion: 0,
    ...strokeBoundingBox(points, brushWidth),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    brushWidth,
    points,
  };

  return mode === 'paint'
    ? { ...base, mode, biome: biome as Biome }
    : { ...base, mode, biome: null };
}
