import { z } from 'zod';
import { portableObjectSchema } from './portableMap.js';

const finite = z.number().finite();
const metadata = {
  id: z.uuid(), mapId: z.uuid(), objectVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), deletedAt: z.iso.datetime().nullable(),
  minX: finite, minY: finite, maxX: finite, maxY: finite,
};

/** Full persisted objects: reuse logical validation without adding defaults or accepting partial geometry. */
export const mapObjectSchema = z.discriminatedUnion('objectType', [
  portableObjectSchema.options[0].safeExtend({ ...metadata, layer: z.literal(0) }),
  portableObjectSchema.options[1].safeExtend({ ...metadata, layer: z.literal(100) }),
  portableObjectSchema.options[2].safeExtend({ ...metadata, layer: z.literal(200) }),
  portableObjectSchema.options[3].safeExtend({ ...metadata, layer: z.literal(300) }),
]).refine(object => object.minX <= object.maxX && object.minY <= object.maxY, 'Invalid object bounds.');
