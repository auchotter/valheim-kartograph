import assert from 'node:assert/strict';
import {
  DEFAULT_MAP_UI_PREFERENCES,
  MAP_UI_PREFERENCES_STORAGE_KEY,
  parseMapUiPreferences,
  readMapUiPreferencesFromStorage,
  writeMapUiPreferencesToStorage,
} from '../client/src/lib/mapUiPreferences.ts';
import { readFileSync } from 'node:fs';

assert.deepEqual(
  parseMapUiPreferences(JSON.stringify({ version: 1, pathOpacity: 0.5, protectEnabled: false, gridEnabled: true })),
  { pathOpacity: 0.5, protectEnabled: false, gridEnabled: true },
);
assert.deepEqual(
  parseMapUiPreferences(JSON.stringify({ version: 1, pathOpacity: 0, protectEnabled: true, gridEnabled: false })),
  { pathOpacity: 0, protectEnabled: true, gridEnabled: false },
);
assert.deepEqual(parseMapUiPreferences(null), DEFAULT_MAP_UI_PREFERENCES);
assert.deepEqual(parseMapUiPreferences('{bad-json'), DEFAULT_MAP_UI_PREFERENCES);
assert.deepEqual(parseMapUiPreferences(JSON.stringify({ version: 1, pathOpacity: 0.25, protectEnabled: false, gridEnabled: true })), DEFAULT_MAP_UI_PREFERENCES);
assert.deepEqual(parseMapUiPreferences(JSON.stringify({ version: 2, pathOpacity: 0.5, protectEnabled: false, gridEnabled: true })), DEFAULT_MAP_UI_PREFERENCES);

const storage = new Map<string, string>();
writeMapUiPreferencesToStorage({
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
}, { pathOpacity: 0.5, protectEnabled: false, gridEnabled: true });
assert.deepEqual(JSON.parse(storage.get(MAP_UI_PREFERENCES_STORAGE_KEY) ?? '{}'), {
  version: 1,
  pathOpacity: 0.5,
  protectEnabled: false,
  gridEnabled: true,
});

const migratedLocal = new Map<string, string>();
const legacySession = new Map<string, string>([
  [MAP_UI_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, pathOpacity: 0.5, protectEnabled: false, gridEnabled: true })],
]);
assert.deepEqual(
  readMapUiPreferencesFromStorage(mapStorage(migratedLocal), mapStorage(legacySession)),
  { pathOpacity: 0.5, protectEnabled: false, gridEnabled: true },
);
assert.equal(migratedLocal.has(MAP_UI_PREFERENCES_STORAGE_KEY), true);

// A later tab/session reads the durable value even when its session store is empty.
assert.deepEqual(
  readMapUiPreferencesFromStorage(mapStorage(migratedLocal), mapStorage(new Map())),
  { pathOpacity: 0.5, protectEnabled: false, gridEnabled: true },
);

assert.deepEqual(
  readMapUiPreferencesFromStorage(
    mapStorage(new Map([[MAP_UI_PREFERENCES_STORAGE_KEY, '{bad-json']])),
    mapStorage(legacySession),
  ),
  DEFAULT_MAP_UI_PREFERENCES,
);

assert.doesNotThrow(() => writeMapUiPreferencesToStorage({
  getItem: () => null,
  setItem: () => { throw new Error('storage unavailable'); },
}, DEFAULT_MAP_UI_PREFERENCES));

const uiSource = readFileSync(new URL('../client/src/lib/mapUiPreferences.ts', import.meta.url), 'utf8');
const cameraSource = readFileSync(new URL('../client/src/lib/cameraViewPersistence.ts', import.meta.url), 'utf8');
assert.match(uiSource, /window\.localStorage/);
assert.match(uiSource, /safeSessionStorage/); // legacy migration only
assert.match(cameraSource, /window\.sessionStorage/);

function mapStorage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

console.log('UI preference persistence verification passed');
