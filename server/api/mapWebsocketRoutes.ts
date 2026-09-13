import type { FastifyInstance } from 'fastify';
import { mapIdParamsSchema } from './validation.js';
import { MapService } from '../services/mapService.js';
import { MapHub } from '../realtime/mapHub.js';
import type { MapReadyMessage } from '../../shared/realtime.js';

export async function registerMapWebsocketRoutes(
  app: FastifyInstance,
  service: MapService,
  hub: MapHub,
): Promise<void> {
  app.get(
    '/api/maps/:mapId/ws',
    {
      websocket: true,
      preHandler: async (request) => {
        const { mapId } = mapIdParamsSchema.parse(request.params);
        service.getMapRevision(mapId);
      },
    },
    (socket, request) => {
      const { mapId } = mapIdParamsSchema.parse(request.params);
      let revision: number;
      try {
        revision = service.getMapRevision(mapId);
      } catch {
        socket.close(4004, 'Map is no longer available');
        return;
      }

      const unsubscribe = hub.subscribe(mapId, socket);
      const ready: MapReadyMessage = { type: 'map.ready', mapId, revision };

      try {
        socket.send(JSON.stringify(ready));
        // V1 is broadcast-only. Attach a synchronous listener so unexpected
        // client messages cannot accumulate in the ws implementation.
        socket.on('message', () => undefined);
      } catch {
        unsubscribe();
        socket.terminate();
      }
    },
  );
}
