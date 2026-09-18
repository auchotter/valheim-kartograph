import { randomUUID } from 'node:crypto';
import { parsePortableMap, portableContentSchema, portableObject, type PortableContent } from '../../shared/portableMap.js';
import {
  MapLayer,
  type Marker,
  type MapObject,
  type MapObjectBase,
  type MapOperation,
  type MapRecord,
} from '../../shared/domain.js';
import type {
  CreateObjectInput,
  DuplicateMapInput,
  LifecycleObjectInput,
  MapNameInput,
  ObjectInput,
  UpdateObjectInput,
} from '../api/validation.js';
import { ConflictError, NotFoundError } from '../api/errors.js';
import { MapRepository } from '../repositories/mapRepository.js';
import { pointBounds, strokedPointBounds } from './bounds.js';

export interface ObjectMutationResult {
  object: MapObject;
  mapRevision: number;
  operation: MapOperation;
  idempotent: boolean;
}

export interface UndoResult {
  undone: boolean;
  reason?: 'empty';
  targetOperationId?: string;
  inverseOperationId?: string;
  mapRevision?: number;
  objectType?: MapObject['objectType'];
  objectId?: string;
  action?: MapOperation['operationType'];
  idempotent: boolean;
  mutation?: ObjectMutationResult;
}

export interface RedoResult {
  redone: boolean;
  reason?: 'empty';
  targetOperationId?: string;
  redoOperationId?: string;
  mapRevision?: number;
  objectType?: MapObject['objectType'];
  objectId?: string;
  action?: MapOperation['operationType'];
  idempotent: boolean;
  mutation?: ObjectMutationResult;
}

const UNDO_REDO_HISTORY_LIMIT = 20;

export type AcceptedObjectMutationListener = (result: ObjectMutationResult) => void;
export type MapDeletedListener = (mapId: string) => void;

export class MapService {
  private readonly acceptedMutationListeners = new Set<AcceptedObjectMutationListener>();
  private readonly mapDeletedListeners = new Set<MapDeletedListener>();

  constructor(private readonly repository: MapRepository) {}

  onAcceptedObjectMutation(listener: AcceptedObjectMutationListener): () => void {
    this.acceptedMutationListeners.add(listener);
    return () => this.acceptedMutationListeners.delete(listener);
  }

  onMapDeleted(listener: MapDeletedListener): () => void {
    this.mapDeletedListeners.add(listener);
    return () => this.mapDeletedListeners.delete(listener);
  }

  listMaps(): MapRecord[] {
    return this.repository.listActiveMaps();
  }

  getMapState(mapId: string): { map: MapRecord; objects: MapObject[] } {
    return { map: this.requireActiveMap(mapId), objects: this.repository.listObjects(mapId) };
  }

  getMapRevision(mapId: string): number {
    return this.requireActiveMap(mapId).revision;
  }

  exportMap(mapId: string): PortableContent {
    return this.repository.transaction(() => {
      const map = this.requireActiveMap(mapId);
      return portableContentSchema.parse({ name: map.name, objects: this.repository.listObjects(mapId)
        .sort((a, b) => a.orderKey - b.orderKey).map(portableObject) });
    });
  }

  importMap(value: unknown): { map: MapRecord; objects: MapObject[] } {
    const snapshot = parsePortableMap(value);
    return this.repository.transaction(() => {
      const source = snapshot.map;
      let name = source.name;
      let suffixNumber = 1;
      while (this.repository.activeMapNameExists(name)) {
        const suffix = suffixNumber === 1 ? ' (Imported)' : ` (Imported ${suffixNumber})`;
        name = source.name.slice(0, 200 - suffix.length) + suffix;
        suffixNumber++;
      }
      const now = timestamp();
      const map: MapRecord = { id: randomUUID(), name, revision: 0,
        nextOrderKey: source.objects.reduce((next, object) => Math.max(next, object.orderKey + 1), 0),
        createdAt: now, updatedAt: now, deletedAt: null };
      // Import is its own baseline, never the blank-map Spawn creation flow.
      this.repository.insertMap(map);
      for (const object of source.objects) {
        this.repository.insertObject(createObjectFromInput(map.id, { ...object, id: randomUUID() }, object.orderKey, now));
      }
      return this.getMapState(map.id);
    });
  }

  createMap(input: MapNameInput): MapRecord {
    return this.repository.transaction(() => {
      this.assertAvailableMapName(input.name);
      const now = timestamp();
      const map: MapRecord = {
        id: randomUUID(),
        name: input.name,
        revision: 0,
        nextOrderKey: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      this.repository.insertMap(map);
      const spawn: Marker = {
        id: randomUUID(),
        mapId: map.id,
        objectType: 'marker',
        layer: MapLayer.Markers,
        orderKey: this.repository.allocateOrderKey(map.id),
        objectVersion: 1,
        ...pointBounds(0, 0),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        markerType: 'spawn',
        x: 0,
        y: 0,
        name: null,
        note: null,
        sizeScale: 1,
        directionDegrees: null,
      };
      this.repository.insertObject(spawn);
      return this.requireActiveMap(map.id);
    });
  }

  renameMap(mapId: string, input: MapNameInput): MapRecord {
    return this.repository.transaction(() => {
      const map = this.requireActiveMap(mapId);
      this.assertAvailableMapName(input.name, mapId);
      const updatedAt = timestamp();
      this.repository.renameMap(mapId, input.name, updatedAt);
      return { ...map, name: input.name, updatedAt };
    });
  }

  deleteMap(mapId: string): void {
    this.repository.transaction(() => {
      this.requireActiveMap(mapId);
      this.repository.softDeleteMap(mapId, timestamp());
    });
    this.publishMapDeleted(mapId);
  }

  duplicateMap(mapId: string, input: DuplicateMapInput): MapRecord {
    return this.repository.transaction(() => {
      this.requireActiveMap(mapId);
      this.assertAvailableMapName(input.name);
      const now = timestamp();
      const duplicate: MapRecord = {
        id: randomUUID(),
        name: input.name,
        revision: 0,
        nextOrderKey: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      this.repository.insertMap(duplicate);

      for (const source of this.repository.listObjects(mapId)) {
        const copied = {
          ...source,
          id: randomUUID(),
          mapId: duplicate.id,
          orderKey: this.repository.allocateOrderKey(duplicate.id),
          objectVersion: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        } as MapObject;
        this.repository.insertObject(copied);
      }
      return this.requireActiveMap(duplicate.id);
    });
  }

  createObject(mapId: string, input: CreateObjectInput): ObjectMutationResult {
    const result = this.repository.transaction(() => {
      this.requireActiveMap(mapId);
      const retry = this.findIdempotentResult(mapId, input.actorId, input.clientOperationId);
      if (retry !== null) {
        return retry;
      }
      if (this.repository.findObject(mapId, input.object.id, true) !== null) {
        throw new ConflictError('An object with this ID already exists in the map.');
      }

      const now = timestamp();
      const object = createObjectFromInput(
        mapId,
        input.object,
        this.repository.allocateOrderKey(mapId),
        now,
      );
      this.repository.insertObject(object);
      return this.acceptMutation(mapId, input.actorId, input.clientOperationId, 'object.create', null, object, null, now);
    });
    this.publishAcceptedObjectMutation(result);
    return result;
  }

  updateObject(mapId: string, objectId: string, input: UpdateObjectInput): ObjectMutationResult {
    const result = this.repository.transaction(() => {
      this.requireActiveMap(mapId);
      const retry = this.findIdempotentResult(mapId, input.actorId, input.clientOperationId);
      if (retry !== null) {
        return retry;
      }
      const current = this.requireActiveObject(mapId, objectId);
      if (current.objectVersion !== input.baseObjectVersion) {
        throw new ConflictError('The object was changed by another accepted operation.');
      }
      if (current.objectType !== input.object.objectType || input.object.id !== objectId) {
        throw new ConflictError('Object ID and object type cannot be changed.');
      }

      const now = timestamp();
      const updated = updateObjectFromInput(current, input.object, now);
      this.repository.updateObject(updated);
      return this.acceptMutation(
        mapId,
        input.actorId,
        input.clientOperationId,
        'object.update',
        current,
        updated,
        input.baseObjectVersion,
        now,
      );
    });
    this.publishAcceptedObjectMutation(result);
    return result;
  }

  deleteObject(mapId: string, objectId: string, input: LifecycleObjectInput): ObjectMutationResult {
    return this.changeObjectDeletion(mapId, objectId, input, true);
  }

  restoreObject(mapId: string, objectId: string, input: LifecycleObjectInput): ObjectMutationResult {
    return this.changeObjectDeletion(mapId, objectId, input, false);
  }

  undoMap(mapId: string, actorId: string, clientOperationId: string): UndoResult {
    const result = this.repository.transaction(() => {
      this.requireActiveMap(mapId);

      const retry = this.repository.findOperation(mapId, actorId, clientOperationId);
      if (retry !== null) {
        if (retry.undoOfOperationId === null) {
          throw new ConflictError('That client operation ID was already used for another mutation.');
        }
        return undoResultFromMutation(retry, true);
      }

      const candidates = this.repository.listUndoCandidates(mapId, actorId, UNDO_REDO_HISTORY_LIMIT);
      for (const target of candidates) {
        const current = target.objectId === null
          ? null
          : this.repository.findObject(mapId, target.objectId, true);
        const targetAfter = asMapObject(target.payload.after);
        if (current === null || targetAfter === null || !sameSemanticObject(current, targetAfter)) {
          continue;
        }

        const targetBefore = asMapObject(target.payload.before);
        const now = timestamp();
        const inverse = inverseObject(target.operationType, current, targetBefore, now);
        if (inverse === null) {
          continue;
        }

        this.repository.updateObject(inverse.object);
        const mutation = this.acceptMutation(
          mapId,
          actorId,
          clientOperationId,
          inverse.operationType,
          current,
          inverse.object,
          current.objectVersion,
          now,
          target.id,
        );
        return undoResultFromMutation(mutation.operation, false, target.id, mutation);
      }

      return { undone: false, reason: 'empty', idempotent: false } satisfies UndoResult;
    });

    if (result.mutation !== undefined) {
      this.publishAcceptedObjectMutation(result.mutation);
    }
    return result;
  }

  redoMap(mapId: string, actorId: string, clientOperationId: string): RedoResult {
    const result = this.repository.transaction(() => {
      this.requireActiveMap(mapId);

      const retry = this.repository.findOperation(mapId, actorId, clientOperationId);
      if (retry !== null) {
        if (retry.redoOfOperationId === null) {
          throw new ConflictError('That client operation ID was already used for another mutation.');
        }
        return redoResultFromMutation(retry, true);
      }

      const candidates = this.repository.listRedoCandidates(mapId, actorId, UNDO_REDO_HISTORY_LIMIT);
      for (const target of candidates) {
        const current = target.objectId === null
          ? null
          : this.repository.findObject(mapId, target.objectId, true);
        const targetAfter = asMapObject(target.payload.after);
        if (current === null || targetAfter === null || !sameSemanticObject(current, targetAfter)) {
          continue;
        }

        const targetBefore = asMapObject(target.payload.before);
        const now = timestamp();
        const inverse = inverseObject(target.operationType, current, targetBefore, now);
        if (inverse === null) {
          continue;
        }

        this.repository.updateObject(inverse.object);
        const mutation = this.acceptMutation(
          mapId,
          actorId,
          clientOperationId,
          inverse.operationType,
          current,
          inverse.object,
          current.objectVersion,
          now,
          null,
          target.id,
        );
        return redoResultFromMutation(mutation.operation, false, target.id, mutation);
      }

      return { redone: false, reason: 'empty', idempotent: false } satisfies RedoResult;
    });

    if (result.mutation !== undefined) {
      this.publishAcceptedObjectMutation(result.mutation);
    }
    return result;
  }

  private changeObjectDeletion(
    mapId: string,
    objectId: string,
    input: LifecycleObjectInput,
    deleting: boolean,
  ): ObjectMutationResult {
    const result = this.repository.transaction(() => {
      this.requireActiveMap(mapId);
      const retry = this.findIdempotentResult(mapId, input.actorId, input.clientOperationId);
      if (retry !== null) {
        return retry;
      }
      const current = this.repository.findObject(mapId, objectId, true);
      if (current === null || (deleting && current.deletedAt !== null)) {
        throw new NotFoundError('Map object was not found.');
      }
      if (!deleting && current.deletedAt === null) {
        throw new ConflictError('The map object is already active.');
      }
      if (current.objectVersion !== input.baseObjectVersion) {
        throw new ConflictError('The object was changed by another accepted operation.');
      }

      const now = timestamp();
      const updated = { ...current, objectVersion: current.objectVersion + 1, updatedAt: now, deletedAt: deleting ? now : null };
      this.repository.setObjectDeleted(mapId, objectId, updated.objectVersion, updated.deletedAt, now);
      return this.acceptMutation(
        mapId,
        input.actorId,
        input.clientOperationId,
        deleting ? 'object.delete' : 'object.restore',
        current,
        updated,
        input.baseObjectVersion,
        now,
      );
    });
    this.publishAcceptedObjectMutation(result);
    return result;
  }

  private publishAcceptedObjectMutation(result: ObjectMutationResult): void {
    if (result.idempotent) {
      return;
    }
    for (const listener of this.acceptedMutationListeners) {
      try {
        listener(result);
      } catch {
        // Subscribers must never turn a committed REST mutation into an error.
      }
    }
  }

  private publishMapDeleted(mapId: string): void {
    for (const listener of this.mapDeletedListeners) {
      try {
        listener(mapId);
      } catch {
        // Map deletion is already committed even if a subscriber cleanup fails.
      }
    }
  }

  private acceptMutation(
    mapId: string,
    actorId: string,
    clientOperationId: string,
    operationType: string,
    before: MapObject | null,
    after: MapObject,
    baseObjectVersion: number | null,
    now: string,
    undoOfOperationId: string | null = null,
    redoOfOperationId: string | null = null,
  ): ObjectMutationResult {
    const mapRevision = this.repository.updateMapRevision(mapId, now);
    const operation: MapOperation = {
      id: randomUUID(),
      mapId,
      mapRevision,
      actorId,
      clientOperationId,
      operationType,
      objectId: after.id,
      baseObjectVersion,
      payload: { before, after },
      createdAt: now,
      undoOfOperationId,
      redoOfOperationId,
    };
    this.repository.insertOperation(operation);
    return { object: after, mapRevision, operation, idempotent: false };
  }

  private findIdempotentResult(mapId: string, actorId: string, clientOperationId: string): ObjectMutationResult | null {
    const operation = this.repository.findOperation(mapId, actorId, clientOperationId);
    if (operation === null) {
      return null;
    }
    const object = operation.payload.after as unknown as MapObject;
    return { object, mapRevision: operation.mapRevision, operation, idempotent: true };
  }

  private requireActiveMap(mapId: string): MapRecord {
    const map = this.repository.findMap(mapId);
    if (map === null) {
      throw new NotFoundError('Map was not found.');
    }
    return map;
  }

  private requireActiveObject(mapId: string, objectId: string): MapObject {
    const object = this.repository.findObject(mapId, objectId);
    if (object === null) {
      throw new NotFoundError('Map object was not found.');
    }
    return object;
  }

  private assertAvailableMapName(name: string, exceptMapId?: string): void {
    if (this.repository.activeMapNameExists(name, exceptMapId)) {
      throw new ConflictError('An active map already uses this name.');
    }
  }
}

function createObjectFromInput(mapId: string, input: ObjectInput, orderKey: number, now: string): MapObject {
  const base: ObjectBase = {
    id: input.id,
    mapId,
    orderKey,
    objectVersion: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...boundsForInput(input),
  };
  return mergeSemanticObject(base, input);
}

function updateObjectFromInput(current: MapObject, input: ObjectInput, now: string): MapObject {
  const base: ObjectBase = {
    id: current.id,
    mapId: current.mapId,
    orderKey: current.orderKey,
    objectVersion: current.objectVersion + 1,
    createdAt: current.createdAt,
    updatedAt: now,
    deletedAt: current.deletedAt,
    ...boundsForInput(input),
  };
  return mergeSemanticObject(
    base,
    input,
    current.objectType === 'label' ? current.referenceZoom : undefined,
  );
}

type ObjectBase = Omit<MapObjectBase, 'objectType' | 'layer'>;

function mergeSemanticObject(base: ObjectBase, input: ObjectInput, currentLabelReferenceZoom = 1): MapObject {
  if (input.objectType === 'biome_stroke') {
    return input.mode === 'paint'
      ? { ...base, objectType: input.objectType, layer: MapLayer.Terrain, mode: input.mode, biome: input.biome!, brushWidth: input.brushWidth, points: input.points }
      : { ...base, objectType: input.objectType, layer: MapLayer.Terrain, mode: input.mode, biome: null, brushWidth: input.brushWidth, points: input.points };
  }
  if (input.objectType === 'path') {
    return {
      ...base,
      objectType: input.objectType,
      layer: MapLayer.Paths,
      pathType: input.pathType,
      geometryType: input.geometryType,
      strokeWidth: input.strokeWidth,
      points: input.points,
    };
  }
  if (input.objectType === 'marker') {
    return {
      ...base,
      objectType: input.objectType,
      layer: MapLayer.Markers,
      markerType: input.markerType,
      x: input.x,
      y: input.y,
      name: input.name,
      note: input.note,
      sizeScale: input.sizeScale,
      directionDegrees: input.directionDegrees,
    };
  }
  return {
    ...base,
    objectType: input.objectType,
    layer: MapLayer.Labels,
    x: input.x,
    y: input.y,
    text: input.text,
    fontSize: input.fontSize,
    referenceZoom: input.referenceZoom ?? currentLabelReferenceZoom,
    rotationDegrees: input.rotationDegrees,
  };
}

function boundsForInput(input: ObjectInput) {
  if (input.objectType === 'biome_stroke') {
    return strokedPointBounds(input.points, input.brushWidth);
  }
  if (input.objectType === 'path') {
    return strokedPointBounds(input.points, input.strokeWidth);
  }
  return pointBounds(input.x, input.y);
}

function asMapObject(value: unknown): MapObject | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Partial<MapObject>;
  return typeof candidate.id === 'string' &&
    typeof candidate.mapId === 'string' &&
    typeof candidate.objectType === 'string'
    ? value as MapObject
    : null;
}

function sameSemanticObject(left: MapObject, right: MapObject): boolean {
  return JSON.stringify(semanticObject(left)) === JSON.stringify(semanticObject(right));
}

function semanticObject(object: MapObject): unknown {
  // The deletion timestamp is generated bookkeeping. Preserve its visible
  // lifecycle state for safety checks without making a later inverse delete
  // look unrelated solely because its timestamp differs.
  const lifecycle = { objectType: object.objectType, deleted: object.deletedAt !== null };
  if (object.objectType === 'biome_stroke') {
    return { ...lifecycle, mode: object.mode, biome: object.biome, brushWidth: object.brushWidth, points: object.points };
  }
  if (object.objectType === 'path') {
    return {
      ...lifecycle,
      pathType: object.pathType,
      geometryType: object.geometryType,
      strokeWidth: object.strokeWidth,
      points: object.points,
    };
  }
  if (object.objectType === 'marker') {
    return {
      ...lifecycle,
      markerType: object.markerType,
      x: object.x,
      y: object.y,
      name: object.name,
      note: object.note,
      sizeScale: object.sizeScale,
      directionDegrees: object.directionDegrees,
    };
  }
  return {
    ...lifecycle,
    x: object.x,
    y: object.y,
    text: object.text,
    fontSize: object.fontSize,
    referenceZoom: object.referenceZoom,
    rotationDegrees: object.rotationDegrees,
  };
}

function inverseObject(
  operationType: string,
  current: MapObject,
  before: MapObject | null,
  now: string,
): { operationType: 'object.update' | 'object.delete' | 'object.restore'; object: MapObject } | null {
  if (operationType === 'object.create' || operationType === 'object.restore') {
    return {
      operationType: 'object.delete',
      object: { ...current, objectVersion: current.objectVersion + 1, updatedAt: now, deletedAt: now },
    };
  }
  if (operationType === 'object.delete') {
    return {
      operationType: 'object.restore',
      object: { ...current, objectVersion: current.objectVersion + 1, updatedAt: now, deletedAt: null },
    };
  }
  if (operationType !== 'object.update' || before === null || before.id !== current.id || before.objectType !== current.objectType) {
    return null;
  }
  return {
    operationType: 'object.update',
    object: {
      ...before,
      id: current.id,
      mapId: current.mapId,
      layer: current.layer,
      orderKey: current.orderKey,
      objectVersion: current.objectVersion + 1,
      createdAt: current.createdAt,
      updatedAt: now,
    } as MapObject,
  };
}

function undoResultFromMutation(
  operation: MapOperation,
  idempotent: boolean,
  targetOperationId = operation.undoOfOperationId ?? operation.id,
  mutation?: ObjectMutationResult,
): UndoResult {
  const object = asMapObject(operation.payload.after) ?? asMapObject(operation.payload.before);
  return {
    undone: true,
    targetOperationId,
    inverseOperationId: operation.id,
    mapRevision: operation.mapRevision,
    objectType: object?.objectType,
    objectId: operation.objectId ?? undefined,
    action: operation.operationType,
    idempotent,
    mutation,
  };
}

function redoResultFromMutation(
  operation: MapOperation,
  idempotent: boolean,
  targetOperationId = operation.redoOfOperationId ?? operation.id,
  mutation?: ObjectMutationResult,
): RedoResult {
  const object = asMapObject(operation.payload.after) ?? asMapObject(operation.payload.before);
  return {
    redone: true,
    targetOperationId,
    redoOperationId: operation.id,
    mapRevision: operation.mapRevision,
    objectType: object?.objectType,
    objectId: operation.objectId ?? undefined,
    action: operation.operationType,
    idempotent,
    mutation,
  };
}

function timestamp(): string {
  return new Date().toISOString();
}
