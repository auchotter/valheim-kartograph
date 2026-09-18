import type { Marker } from '../../../shared/domain';

/** No selection/draft cleanup is allowed until every required save succeeds. */
export function persistMarkerDraftBeforeTransfer(options: {
  marker: Marker; draft: Marker; pending?: Promise<boolean>; pendingDraft?: Marker;
  isCurrent: () => boolean; save: (draft: Marker) => Promise<boolean>; accepted: () => void;
}): boolean | Promise<boolean> {
  const { marker, draft, pending, pendingDraft, isCurrent, save, accepted } = options;
  const matches = (other: Marker | undefined) => other?.name === draft.name && other?.directionDegrees === draft.directionDegrees;
  if (pending === undefined && matches(marker)) return true;
  return (async () => {
    if (pending !== undefined && !(await pending)) return false;
    if (!isCurrent()) return false;
    if (pending === undefined || !matches(pendingDraft)) {
      if (!(await save(draft))) return false;
    }
    if (!isCurrent()) return false;
    accepted();
    return true;
  })();
}
