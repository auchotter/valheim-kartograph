import { z } from 'zod';
import { supportedMarkerTypeSchema } from './markerTypes.js';
import type { MapObject } from './domain.js';

export const VALHEIM_KARTOGRAPH_FORMAT = 'valheim-kartograph';
export const VALHEIM_KARTOGRAPH_FORMAT_VERSION = 1;
export const APPLICATION_NAME = 'Valheim Kartograph';
export const APPLICATION_VERSION = '1.0';
export const MAP_FILE_EXTENSION = '.valheim-kartograph.json';
export const MAP_FILE_MIME = 'application/json';
export const MAX_MAP_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_PORTABLE_POINTS = 2_000_000;
export const PORTABLE_COUNTS = { biome_stroke: 100_000, path: 25_000, marker: 25_000, label: 25_000 } as const;

const finite = z.number().finite();
// Avoid finite-but-overflowing coordinates in derived geometry calculations.
const coordinate = finite.min(-1e9).max(1e9);
const points = z.array(z.tuple([coordinate, coordinate])).max(20_000);
const orderKey = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const nonBlank = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0, 'Must not be blank.');
const biome = z.enum(['meadows', 'black_forest', 'swamp', 'mountains', 'plains', 'mistlands', 'ashlands', 'lava', 'deep_north', 'ocean']);
const markerType = supportedMarkerTypeSchema;

export const portableObjectSchema = z.discriminatedUnion('objectType', [
  z.object({ objectType: z.literal('biome_stroke'), orderKey, mode: z.enum(['paint', 'erase']), biome: biome.nullable(), brushWidth: finite.positive().max(100_000), points: points.min(1) }).strict().refine(v => v.mode === 'erase' ? v.biome === null : v.biome !== null, 'Invalid terrain mode/biome combination.'),
  z.object({ objectType: z.literal('path'), orderKey, pathType: z.enum(['path', 'road', 'river', 'sailing_route']), geometryType: z.enum(['freehand', 'straight', 'curve']), strokeWidth: finite.positive().max(100_000), points: points.min(2) }).strict().refine(v => v.geometryType === 'freehand' || v.points.length === (v.geometryType === 'straight' ? 2 : 3), 'Invalid path geometry point count.'),
  z.object({ objectType: z.literal('marker'), orderKey, markerType, x: coordinate, y: coordinate, name: z.string().max(500).nullable(), note: z.string().max(10_000).nullable(), sizeScale: finite.positive().max(10), directionDegrees: finite.min(0).lt(360).nullable() }).strict(),
  z.object({ objectType: z.literal('label'), orderKey, x: coordinate, y: coordinate, text: nonBlank(1_000), fontSize: finite.positive().max(1_000), referenceZoom: finite.positive().max(8), rotationDegrees: finite.min(0).lt(360) }).strict(),
]);

export const portableContentSchema = z.object({
  name: nonBlank(200),
  objects: z.array(portableObjectSchema).max(175_000),
}).strict().superRefine((map, ctx) => {
  const counts = { biome_stroke: 0, path: 0, marker: 0, label: 0 };
  const orders = new Set<number>();
  let pointCount = 0;
  for (const object of map.objects) {
    counts[object.objectType]++;
    if ('points' in object) pointCount += object.points.length;
    if (orders.has(object.orderKey)) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate object orderKey.' });
      break;
    }
    orders.add(object.orderKey);
  }
  if (pointCount > MAX_PORTABLE_POINTS) ctx.addIssue({ code: 'custom', message: 'Too many geometry points.' });
  for (const type of Object.keys(counts) as (keyof typeof counts)[]) {
    if (counts[type] > PORTABLE_COUNTS[type]) ctx.addIssue({ code: 'custom', message: `Too many ${type} objects.` });
  }
});

export const portableWorkspaceSchema = z.object({
  markerOpacity: finite.min(0).max(1), pathOpacity: finite.min(0).max(1), textOpacity: finite.min(0).max(1),
  gridEnabled: z.boolean(), protectEnabled: z.boolean(),
  camera: z.object({ cameraX: coordinate, cameraY: coordinate, zoom: finite.min(0.05).max(8) }).strict(),
}).strict();

export const portableMapSchema = z.object({
  format: z.literal(VALHEIM_KARTOGRAPH_FORMAT),
  formatVersion: z.literal(VALHEIM_KARTOGRAPH_FORMAT_VERSION),
  application: z.object({ name: z.literal(APPLICATION_NAME), version: nonBlank(50) }).strict(),
  exportedAt: z.iso.datetime(),
  map: portableContentSchema,
  workspace: portableWorkspaceSchema,
}).strict();
export type PortableContent = z.infer<typeof portableContentSchema>;
export type PortableWorkspace = z.infer<typeof portableWorkspaceSchema>;
export type PortableMap = z.infer<typeof portableMapSchema>;

export function parsePortableMap(value: unknown): PortableMap {
  if (typeof value !== 'object' || value === null || !('format' in value) || value.format !== VALHEIM_KARTOGRAPH_FORMAT) {
    throw new Error('Invalid Valheim Kartograph map file.');
  }
  if (!('formatVersion' in value) || value.formatVersion !== VALHEIM_KARTOGRAPH_FORMAT_VERSION) {
    throw new Error('Unsupported Valheim Kartograph export version.');
  }
  const result = portableMapSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid Valheim Kartograph map file: ${result.error.issues[0]?.message}`);
  return result.data;
}

export function parsePortableMapJson(text: string): PortableMap {
  if (new TextEncoder().encode(text).byteLength > MAX_MAP_FILE_BYTES) throw new Error('Valheim Kartograph map files must be at most 64 MiB.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid Valheim Kartograph map file: invalid JSON.'); }
  return parsePortableMap(value);
}

export function createPortableMap(map: PortableContent, workspace: PortableWorkspace): PortableMap {
  return parsePortableMap({ format: VALHEIM_KARTOGRAPH_FORMAT, formatVersion: VALHEIM_KARTOGRAPH_FORMAT_VERSION,
    application: { name: APPLICATION_NAME, version: APPLICATION_VERSION }, exportedAt: new Date().toISOString(), map, workspace });
}

/** Explicit allowlist: never expose persistence IDs, history, or derived bounds. */
export function portableObject(object: MapObject): z.infer<typeof portableObjectSchema> {
  const base = { objectType: object.objectType, orderKey: object.orderKey };
  switch (object.objectType) {
    case 'biome_stroke': return { ...base, objectType: object.objectType, mode: object.mode, biome: object.biome, brushWidth: object.brushWidth, points: object.points.map(p => [p[0], p[1]]) };
    case 'path': return { ...base, objectType: object.objectType, pathType: object.pathType, geometryType: object.geometryType, strokeWidth: object.strokeWidth, points: object.points.map(p => [p[0], p[1]]) };
    case 'marker': return portableObjectSchema.parse({ ...base, objectType: object.objectType, markerType: object.markerType, x: object.x, y: object.y, name: object.name, note: object.note, sizeScale: object.sizeScale, directionDegrees: object.directionDegrees });
    case 'label': return { ...base, objectType: object.objectType, x: object.x, y: object.y, text: object.text, fontSize: object.fontSize, referenceZoom: object.referenceZoom, rotationDegrees: object.rotationDegrees };
  }
}

export function portableFilename(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'Map';
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? '_' : ''}${safe}${MAP_FILE_EXTENSION}`;
}
