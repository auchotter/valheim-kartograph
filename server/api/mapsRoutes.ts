import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  createObjectSchema,
  duplicateMapSchema,
  lifecycleObjectSchema,
  mapIdParamsSchema,
  mapNameSchema,
  objectIdParamsSchema,
  redoSchema,
  undoSchema,
  updateObjectSchema,
} from './validation.js';
import { MapService } from '../services/mapService.js';
import { MAX_MAP_FILE_BYTES, parsePortableMap } from '../../shared/portableMap.js';

export async function registerMapRoutes(app: FastifyInstance, service: MapService): Promise<void> {
  app.get('/api/maps', async () => ({ maps: service.listMaps() }));

  app.get('/api/maps/:mapId/export', async (request) => {
    const { mapId } = parse(mapIdParamsSchema, request.params);
    return service.exportMap(mapId);
  });

  app.post('/api/maps/import', {
    bodyLimit: MAX_MAP_FILE_BYTES,
    errorHandler(error, _request, reply) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 413) return reply.code(413).send({ error: 'Valheim Kartograph map files must be at most 64 MiB.' });
      if (status === 400) return reply.code(400).send({ error: 'Invalid Valheim Kartograph map file: invalid JSON.' });
      app.log.error(error);
      return reply.code(500).send({ error: 'Valheim Kartograph map import failed. No map was imported.' });
    },
  }, async (request, reply) => {
    let snapshot;
    try { snapshot = parsePortableMap(request.body); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid Valheim Kartograph map file.' }); }
    return reply.code(201).send(service.importMap(snapshot));
  });

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

  app.post('/api/maps/:mapId/redo', async (request) => {
    const { mapId } = parse(mapIdParamsSchema, request.params);
    const input = parse(redoSchema, request.body);
    const result = service.redoMap(mapId, input.actorId, input.clientOperationId);
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
