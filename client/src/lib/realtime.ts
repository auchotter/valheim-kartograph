import { z } from 'zod';
import { mapObjectSchema } from '../../../shared/mapObjectValidation';
import type { MapObject } from '../../../shared/domain';
import type { MapObjectAcceptedMessage, RealtimeServerMessage } from '../../../shared/realtime';

const objectTypeSchema = z.enum(['biome_stroke', 'path', 'marker', 'label']);
const messageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('map.ready'),
    mapId: z.uuid(),
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('map.unavailable'),
    mapId: z.uuid(),
  }),
  z.object({
    type: z.literal('map.object.accepted'),
    mapId: z.uuid(),
    revision: z.number().int().positive(),
    operationId: z.uuid(),
    actorId: z.uuid(),
    clientOperationId: z.uuid(),
    operationType: z.enum(['object.create', 'object.update', 'object.delete', 'object.restore']),
    objectId: z.uuid(),
    objectType: objectTypeSchema,
    baseObjectVersion: z.number().int().positive().nullable(),
    createdAt: z.string().min(1),
    payload: z.object({
      before: z.unknown().nullable(),
      after: z.unknown().nullable(),
    }),
  }),
]);

export function mapWebSocketUrl(mapId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/maps/${mapId}/ws`;
}

export function parseRealtimeMessage(value: unknown): RealtimeServerMessage | null {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = messageSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.type !== 'map.object.accepted') {
    return parsed.data;
  }

  const before = parsed.data.payload.before === null ? null : asMapObject(parsed.data.payload.before);
  const after = parsed.data.payload.after === null ? null : asMapObject(parsed.data.payload.after);
  if ((parsed.data.payload.before !== null && before === null) || (parsed.data.payload.after !== null && after === null)) {
    return null;
  }
  const event = parsed.data;
  if ([before, after].some(object => object !== null && (object.id !== event.objectId
    || object.mapId !== event.mapId || object.objectType !== event.objectType))) return null;

  return {
    ...parsed.data,
    payload: { before, after },
  } as MapObjectAcceptedMessage;
}

export function applyAcceptedObjectEvent(
  objects: readonly MapObject[],
  event: MapObjectAcceptedMessage,
): MapObject[] | null {
  if (event.payload.after !== null && event.payload.after.mapId !== event.mapId) {
    return null;
  }

  if (event.operationType === 'object.delete') {
    return objects.filter((object) => object.id !== event.objectId);
  }

  const after = event.payload.after;
  if (after === null || after.id !== event.objectId || after.objectType !== event.objectType) {
    return null;
  }

  const existingIndex = objects.findIndex((object) => object.id === after.id);
  if (existingIndex === -1) {
    return [...objects, after];
  }
  return objects.map((object) => (object.id === after.id ? after : object));
}

export type RealtimeRevisionDecision = 'old' | 'duplicate' | 'next' | 'gap';

export function classifyRealtimeRevision(localRevision: number, receivedRevision: number): RealtimeRevisionDecision {
  if (receivedRevision < localRevision) {
    return 'old';
  }
  if (receivedRevision === localRevision) {
    return 'duplicate';
  }
  if (receivedRevision === localRevision + 1) {
    return 'next';
  }
  return 'gap';
}

function asMapObject(value: unknown): MapObject | null {
  const parsed = mapObjectSchema.safeParse(value);
  // Terrain mode/biome correlation is enforced by the shared schema refinement.
  return parsed.success ? parsed.data as MapObject : null;
}
