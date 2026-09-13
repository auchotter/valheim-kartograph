import type { WebSocket } from 'ws';
import type { MapObjectAcceptedMessage, MapUnavailableMessage } from '../../shared/realtime.js';

export class MapHub {
  private readonly subscribers = new Map<string, Set<WebSocket>>();

  subscribe(mapId: string, socket: WebSocket): () => void {
    let mapSubscribers = this.subscribers.get(mapId);
    if (mapSubscribers === undefined) {
      mapSubscribers = new Set<WebSocket>();
      this.subscribers.set(mapId, mapSubscribers);
    }
    mapSubscribers.add(socket);

    let removed = false;
    const remove = (): void => {
      if (removed) {
        return;
      }
      removed = true;
      mapSubscribers?.delete(socket);
      if (mapSubscribers?.size === 0) {
        this.subscribers.delete(mapId);
      }
    };

    socket.once('close', remove);
    socket.once('error', remove);
    return remove;
  }

  broadcast(event: MapObjectAcceptedMessage): void {
    this.sendToMap(event.mapId, event);
  }

  closeMap(mapId: string): void {
    const event: MapUnavailableMessage = { type: 'map.unavailable', mapId };
    const subscribers = this.subscribers.get(mapId);
    if (subscribers === undefined) {
      return;
    }

    const payload = JSON.stringify(event);
    for (const socket of [...subscribers]) {
      try {
        if (socket.readyState === 1) {
          socket.send(payload);
          socket.close(4004, 'Map is no longer available');
        }
      } catch {
        this.removeSocket(mapId, socket);
      }
    }
  }

  subscriberCount(mapId: string): number {
    return this.subscribers.get(mapId)?.size ?? 0;
  }

  private sendToMap(mapId: string, event: MapObjectAcceptedMessage): void {
    const subscribers = this.subscribers.get(mapId);
    if (subscribers === undefined) {
      return;
    }

    const payload = JSON.stringify(event);
    for (const socket of [...subscribers]) {
      try {
        if (socket.readyState !== 1) {
          this.removeSocket(mapId, socket);
          continue;
        }
        socket.send(payload);
      } catch {
        this.removeSocket(mapId, socket);
      }
    }
  }

  private removeSocket(mapId: string, socket: WebSocket): void {
    const subscribers = this.subscribers.get(mapId);
    subscribers?.delete(socket);
    if (subscribers?.size === 0) {
      this.subscribers.delete(mapId);
    }
    try {
      socket.terminate();
    } catch {
      // The socket may already be closed.
    }
  }
}
