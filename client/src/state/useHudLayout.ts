import { useSyncExternalStore } from 'react';
import { HUD_MEDIUM_QUERY, HUD_WIDE_QUERY, hudLayoutMode } from '../lib/hudLayout';

function subscribe(onChange: () => void): () => void {
  const queries = [window.matchMedia(HUD_WIDE_QUERY), window.matchMedia(HUD_MEDIUM_QUERY)];
  queries.forEach((query) => query.addEventListener('change', onChange));
  return () => queries.forEach((query) => query.removeEventListener('change', onChange));
}

function getSnapshot() {
  return hudLayoutMode(window.matchMedia(HUD_WIDE_QUERY).matches, window.matchMedia(HUD_MEDIUM_QUERY).matches);
}

export function useHudLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'wide' as const);
}
