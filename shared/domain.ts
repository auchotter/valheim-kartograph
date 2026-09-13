/** A UUID v4 string generated with `crypto.randomUUID()`. */
export type Id = string;

/** An ISO-8601 UTC timestamp. */
export type IsoTimestamp = string;

/** A coordinate in the map's zoom-independent world coordinate system. */
export type WorldPoint = readonly [x: number, y: number];

export type Biome =
  | 'meadows'
  | 'black_forest'
  | 'swamp'
  | 'mountains'
  | 'plains'
  | 'mistlands'
  | 'ashlands'
  | 'lava'
  | 'deep_north'
  | 'ocean';

export type PathType = 'path' | 'road' | 'river' | 'sailing_route';

export type PathGeometryType = 'freehand' | 'straight' | 'curve';

export type BiomeStrokeMode = 'paint' | 'erase';

export enum MapLayer {
  Terrain = 0,
  Paths = 100,
  Markers = 200,
  Labels = 300,
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapRecord {
  id: Id;
  name: string;
  revision: number;
  nextOrderKey: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface MapObjectBase extends BoundingBox {
  id: Id;
  mapId: Id;
  objectType: 'biome_stroke' | 'path' | 'marker' | 'label';
  layer: MapLayer;
  orderKey: number;
  objectVersion: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface PaintBiomeStroke extends MapObjectBase {
  objectType: 'biome_stroke';
  layer: MapLayer.Terrain;
  mode: 'paint';
  biome: Biome;
  brushWidth: number;
  points: WorldPoint[];
}

export interface EraseBiomeStroke extends MapObjectBase {
  objectType: 'biome_stroke';
  layer: MapLayer.Terrain;
  mode: 'erase';
  biome: null;
  brushWidth: number;
  points: WorldPoint[];
}

export type BiomeStroke = PaintBiomeStroke | EraseBiomeStroke;

export interface Path extends MapObjectBase {
  objectType: 'path';
  layer: MapLayer.Paths;
  pathType: PathType;
  geometryType: PathGeometryType;
  strokeWidth: number;
  points: WorldPoint[];
}

export interface Marker extends MapObjectBase {
  objectType: 'marker';
  layer: MapLayer.Markers;
  markerType: string;
  x: number;
  y: number;
  name: string | null;
  note: string | null;
  sizeScale: number;
  directionDegrees: number | null;
}

export interface Label extends MapObjectBase {
  objectType: 'label';
  layer: MapLayer.Labels;
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export type MapObject = BiomeStroke | Path | Marker | Label;

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AcceptedOperationPayload {
  before: MapObject | JsonValue | null;
  after: MapObject | JsonValue | null;
}

export interface MapOperation {
  id: Id;
  mapId: Id;
  mapRevision: number;
  actorId: string;
  clientOperationId: Id;
  operationType: string;
  objectId: Id | null;
  baseObjectVersion: number | null;
  payload: AcceptedOperationPayload;
  createdAt: IsoTimestamp;
}
