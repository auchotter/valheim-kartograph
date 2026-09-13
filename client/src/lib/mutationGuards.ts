import type { Id } from '../../../shared/domain';

/** Tracks local mutations without allowing an object ID from one map to lock another map. */
export class ScopedMutationGuard {
  private readonly keys = new Set<string>();

  tryAcquire(mapId: Id, objectId: Id): boolean {
    const key = mutationKey(mapId, objectId);
    if (this.keys.has(key)) {
      return false;
    }
    this.keys.add(key);
    return true;
  }

  release(mapId: Id, objectId: Id): void {
    this.keys.delete(mutationKey(mapId, objectId));
  }

  isPending(mapId: Id, objectId: Id): boolean {
    return this.keys.has(mutationKey(mapId, objectId));
  }

  clear(): void {
    this.keys.clear();
  }
}

export function mutationKey(mapId: Id, objectId: Id): string {
  return `${mapId}:${objectId}`;
}
