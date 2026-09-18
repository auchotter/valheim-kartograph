import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { ZodError } from 'zod';
import { ApiError } from './api/errors.js';
import { registerMapRoutes } from './api/mapsRoutes.js';
import { registerMapWebsocketRoutes } from './api/mapWebsocketRoutes.js';
import { MapRepository } from './repositories/mapRepository.js';
import { MapHub } from './realtime/mapHub.js';
import { acceptedMutationEvent } from './realtime/mapEvents.js';
import { MapService } from './services/mapService.js';

interface CreateAppOptions {
  database: Database.Database;
  staticRoot?: string;
}

export async function createApp({ database, staticRoot }: CreateAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Register now so WebSocket routes can be added without changing server architecture.
  await app.register(websocket);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Invalid request', details: error.issues });
    }
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (isUniqueConstraintError(error)) {
      return reply.code(409).send({ error: 'Conflicting active map name or object ID.' });
    }
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      && error.statusCode >= 400 && error.statusCode < 500) {
      app.log.info({ err: error }, 'Request rejected');
      return reply.code(error.statusCode).send({ error: error.statusCode === 400 ? 'Invalid request' : 'Request rejected' });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  });

  app.get('/api/health', async () => {
    database.prepare('SELECT 1').get();

    return {
      status: 'ok',
      database: 'available',
    };
  });

  const service = new MapService(new MapRepository(database));
  const hub = new MapHub();
  service.onAcceptedObjectMutation((result) => {
    hub.broadcast(acceptedMutationEvent(result));
  });
  service.onMapDeleted((mapId) => {
    hub.closeMap(mapId);
  });

  await registerMapRoutes(app, service);
  await registerMapWebsocketRoutes(app, service, hub);

  if (staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/api' || pathname.startsWith('/api/') || /\/[^/]*\.[^/]+$/.test(pathname)
        || /^\/(?:assets|markers|fonts)(?:\/|$)/.test(pathname)
        || !['GET', 'HEAD'].includes(request.method)) {
        return reply.code(404).send({ error: 'Not Found' });
      }

      return reply.sendFile('index.html');
    });
  }

  return app;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')
  );
}
