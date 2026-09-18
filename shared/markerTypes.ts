import { z } from 'zod';

/** Supported v1.0 semantic types, not filenames or terrain-dependent artwork. */
export const SUPPORTED_MARKER_TYPES = [
  'home', 'chest', 'campfire', 'mining', 'trade', 'signpost', 'ship', 'portal',
  'cave-1', 'cave-2', 'fortress', 'tower', 'crypt', 'castle', 'potion', 'egg',
  'farm', 'berry', 'tree-1', 'tree-2', 'boar', 'chicken', 'wolf', 'sap', 'tar',
  'vegvisir', 'death', 'boss-1', 'boss-2', 'helmet', 'spawn', 'target', 'pin',
  'positive', 'negative',
] as const;

export const supportedMarkerTypeSchema = z.enum(SUPPORTED_MARKER_TYPES);
export type SupportedMarkerType = z.infer<typeof supportedMarkerTypeSchema>;
