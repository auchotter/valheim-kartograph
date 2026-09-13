import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  createObjectSchema,
  duplicateMapSchema,
  lifecycleObjectSchema,
  mapIdParamsSchema,
  mapNameSchema,
  objectIdParamsSchema,
  undoSchema,
  updateObjectSchema,
} from './validation.js';
import { MapService } from '../services/mapService.js';

export async function registerMapRoutes(app: FastifyInstance, service: MapService): Promise<void> {
  app.get('/api/maps', async () => ({ maps: service.listMaps() }));

  app.post('/api/maps', async (request, reply) => {
    const map = service.createMap(parse(mapNameSchema, request.body));
    return reply.code(201).send({ map });
  });

  app.get('/api/maps/:mapId', async (request) => {
    const { mapId } = parse(mapIdParamsSchema, request.params);
    return service.getMapState(mapId);
  });

  app.patch('/api/maps/:mapId', async (request) => {
    const { mapId } = parse(mapIdParamsSchema, request.params);
    return { map: service.renameMap(mapId, parse(mapNameSchema, request.body)) };
  });

  app.delete('/api/maps/:mapId', async (request, reply) => {
    const { mapId } = parse(mapIdParamsSchema, request.params);
    service.deleteMap(mapId);
    return reply.code(204).send();
  });

  app.post('/api/maps/:mapId/duplicate', async (request, reply) => {
    const { mapId } = parse(mapIdParamsSchema, request.params);
    const map = service.duplicateMap(mapId, parse(duplicateMapSchema, request.body));
    return reply.code(201).send({ map });
  });

  app.post('/api/maps/:mapId/objects', async (request, reply) => {
    const { mapId } = parse(mapIdParamsSchema, request.params);
    const result = service.createObject(mapId, parse(createObjectSchema, request.body));
    return reply.code(result.idempotent ? 200 : 201).send(result);
  });

  app.post('/api/maps/:mapId/undo', async (request) => {
    const { mapId } = parse(mapIdParamsSchema, request.params);
    const input = parse(undoSchema, request.body);
    const result = service.undoMap(mapId, input.actorId, input.clientOperationId);
    const { mutation: _mutation, ...response } = result;
    return response;
  });

  app.put('/api/maps/:mapId/objects/:objectId', async (request) => {
    const { mapId, objectId } = parse(objectIdParamsSchema, request.params);
    return service.updateObject(mapId, objectId, parse(updateObjectSchema, request.body));
  });

  app.delete('/api/maps/:mapId/objects/:objectId', async (request) => {
    const { mapId, objectId } = parse(objectIdParamsSchema, request.params);
    return service.deleteObject(mapId, objectId, parse(lifecycleObjectSchema, request.body));
  });

  app.post('/api/maps/:mapId/objects/:objectId/restore', async (request) => {
    const { mapId, objectId } = parse(objectIdParamsSchema, request.params);
    return service.restoreObject(mapId, objectId, parse(lifecycleObjectSchema, request.body));
  });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
