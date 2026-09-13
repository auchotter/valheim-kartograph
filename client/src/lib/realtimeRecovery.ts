import { ApiClientError } from '../api/http';

/** A map-session recovery must stop retrying when the selected map is gone. */
export function isMissingMapRecoveryError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}
