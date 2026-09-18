import { z } from 'zod';
import { supportedMarkerTypeSchema } from '../../shared/markerTypes.js';

const uuid = z.uuid();
const finiteNumber = z.number().finite();
const nonEmptyString = z.string().trim().min(1);
const worldPoint = z.tuple([finiteNumber, finiteNumber]);
const points = z.array(worldPoint).max(20_000);

export const mapIdParamsSchema = z.object({ mapId: uuid });
export const objectIdParamsSchema = z.object({ mapId: uuid, objectId: uuid });
export const mapNameSchema = z.object({ name: nonEmptyString.max(200) });
export const duplicateMapSchema = mapNameSchema;

const mutationMetadataSchema = z.object({
  actorId: uuid,
  clientOperationId: uuid,
});

const biomeStrokeSchema = z
  .object({
    id: uuid,
    objectType: z.literal('biome_stroke'),
    mode: z.enum(['paint', 'erase']),
    biome: z
      .enum([
        'ocean',
        'meadows',
        'black_forest',
        'swamp',
        'mountains',
        'plains',
        'mistlands',
        'ashlands',
        'lava',
        'deep_north',
      ])
      .nullable(),
    brushWidth: finiteNumber.positive().max(100_000),
    points: points.min(1),
  })
  .superRefine((value, context) => {
    if (value.mode === 'paint' && value.biome === null) {
      context.addIssue({ code: 'custom', path: ['biome'], message: 'Paint strokes require a biome.' });
    }
    if (value.mode === 'erase' && value.biome !== null) {
      context.addIssue({ code: 'custom', path: ['biome'], message: 'Erase strokes must have a null biome.' });
    }
  });

const pathSchema = z
  .object({
    id: uuid,
    objectType: z.literal('path'),
    pathType: z.enum(['path', 'road', 'river', 'sailing_route']),
    geometryType: z.enum(['freehand', 'straight', 'curve']),
    strokeWidth: finiteNumber.positive().max(100_000),
    points,
  })
  .superRefine((value, context) => {
    const requiredPointCount =
      value.geometryType === 'straight' ? 2 : value.geometryType === 'curve' ? 3 : undefined;
    if (requiredPointCount !== undefined && value.points.length !== requiredPointCount) {
      context.addIssue({
        code: 'custom',
        path: ['points'],
        message: `${value.geometryType} paths require exactly ${requiredPointCount} points.`,
      });
    }
    if (value.geometryType === 'freehand' && value.points.length < 2) {
      context.addIssue({ code: 'custom', path: ['points'], message: 'Freehand paths require at least two points.' });
    }
  });

const markerSchema = z.object({
  id: uuid,
  objectType: z.literal('marker'),
  markerType: supportedMarkerTypeSchema,
  x: finiteNumber,
  y: finiteNumber,
  name: z.string().trim().max(500).nullable().optional().default(null),
  note: z.string().max(10_000).nullable().optional().default(null),
  sizeScale: finiteNumber.positive().max(10).optional().default(1),
  directionDegrees: finiteNumber.gte(0).lt(360).nullable().optional().default(null),
});

const labelSchema = z.object({
  id: uuid,
  objectType: z.literal('label'),
  x: finiteNumber,
  y: finiteNumber,
  text: nonEmptyString.max(1_000),
  fontSize: finiteNumber.positive().max(1_000).optional().default(16),
  referenceZoom: finiteNumber.positive().max(8).optional(),
  rotationDegrees: finiteNumber.gte(0).lt(360).optional().default(0),
});

export const objectInputSchema = z.discriminatedUnion('objectType', [
  biomeStrokeSchema,
  pathSchema,
  markerSchema,
  labelSchema,
]);

export const createObjectSchema = mutationMetadataSchema.extend({ object: objectInputSchema });
export const updateObjectSchema = mutationMetadataSchema.extend({
  baseObjectVersion: z.number().int().positive(),
  object: objectInputSchema,
});
export const lifecycleObjectSchema = mutationMetadataSchema.extend({
  baseObjectVersion: z.number().int().positive(),
});
export const undoSchema = mutationMetadataSchema;
export const redoSchema = mutationMetadataSchema;

export type MapNameInput = z.infer<typeof mapNameSchema>;
export type DuplicateMapInput = z.infer<typeof duplicateMapSchema>;
export type ObjectInput = z.infer<typeof objectInputSchema>;
export type CreateObjectInput = z.infer<typeof createObjectSchema>;
export type UpdateObjectInput = z.infer<typeof updateObjectSchema>;
export type LifecycleObjectInput = z.infer<typeof lifecycleObjectSchema>;
export type UndoInput = z.infer<typeof undoSchema>;
export type RedoInput = z.infer<typeof redoSchema>;
