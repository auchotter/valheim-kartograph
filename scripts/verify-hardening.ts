import assert from 'node:assert/strict';
import { ApiClientError } from '../client/src/api/http.ts';
import { ScopedMutationGuard } from '../client/src/lib/mutationGuards.ts';
import { isMissingMapRecoveryError } from '../client/src/lib/realtimeRecovery.ts';

const guard = new ScopedMutationGuard();
assert.equal(guard.tryAcquire('map-a', 'path-a'), true);
assert.equal(guard.tryAcquire('map-a', 'path-a'), false);
assert.equal(guard.tryAcquire('map-a', 'path-b'), true);
assert.equal(guard.isPending('map-a', 'path-a'), true);
assert.equal(guard.isPending('map-b', 'path-a'), false);
guard.release('map-a', 'path-a');
assert.equal(guard.tryAcquire('map-a', 'path-a'), true);
guard.release('map-a', 'path-a');
guard.release('map-a', 'path-b');
assert.equal(guard.tryAcquire('map-a', 'path-a'), true);
guard.clear();
assert.equal(guard.isPending('map-a', 'path-a'), false);
// A late completion from the old map cannot release a same-named object in a
// replacement map because the guard key includes the map ID.
assert.equal(guard.tryAcquire('map-b', 'path-a'), true);
guard.release('map-a', 'path-a');
assert.equal(guard.isPending('map-b', 'path-a'), true);
guard.release('map-b', 'path-a');

// A confirmed missing-map response is the only recovery failure that should
// retire the session instead of scheduling another reconnect.
const notFound = new ApiClientError('Map not found.', 404);
assert.equal(isMissingMapRecoveryError(notFound), true);
assert.equal(isMissingMapRecoveryError(new ApiClientError('Server unavailable.', 503)), false);

console.log('Hardening verification passed.');
