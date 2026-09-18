# Valheim Kartograph portable maps — format v1

Files use `.valheim-kartograph.json`, MIME `application/json`, and two-space JSON indentation.
Compatibility is determined by `format` and `formatVersion`, independently of application version.
The executable schema and parser live in `shared/portableMap.ts`.

```json
{
  "format": "valheim-kartograph",
  "formatVersion": 1,
  "application": { "name": "Valheim Kartograph", "version": "1.0" },
  "exportedAt": "2026-09-17T20:30:00.000Z",
  "map": { "name": "Draumik", "objects": [] },
  "workspace": {
    "markerOpacity": 0.37,
    "pathOpacity": 0.62,
    "textOpacity": 0.84,
    "gridEnabled": true,
    "protectEnabled": false,
    "camera": { "cameraX": 123, "cameraY": -456, "zoom": 0.79 }
  }
}
```

## Content

Every object contains `objectType` and its original unique integer `orderKey`.
Export sorts by `orderKey`; import preserves it exactly, including gaps, so semantic
paint/erase chronology and rendering order survive. Layers and bounds are derived
from object type/content using the ordinary object construction path.

| objectType | Additional fields |
| --- | --- |
| `biome_stroke` | `mode`, nullable `biome`, `brushWidth`, `points` |
| `path` | `pathType`, `geometryType`, `strokeWidth`, `points` |
| `marker` | `markerType`, `x`, `y`, nullable `name` and `note`, `sizeScale`, nullable `directionDegrees` |
| `label` | `x`, `y`, `text`, `fontSize`, `referenceZoom`, `rotationDegrees` |

Points are `[mapX, mapY]` pairs: Valheim X, negative Valheim Z. Path geometry is
freehand (at least two points), straight (two), or curve (three, including control).
Marker IDs identify the installed catalogue or supported historical aliases; artwork
and fonts are never embedded. Label font size and reference zoom are copied, never
re-anchored. Active semantic erasers are content, not deleted history.

Excluded: deleted objects, database IDs, versions, revisions, timestamps other than
`exportedAt`, operation history, actor IDs, derived bounds, assets, Debug preferences,
active tool, selections, drafts, popups, focus and machine/server configuration.

## Import and export

`GET /api/maps/:mapId/export` reads a consistent authoritative content snapshot.
The browser adds its current portable workspace settings and downloads the package.
Export never writes map data or emits collaboration events.

The browser validates the file before `POST /api/maps/import`; the server validates
again. A single SQLite transaction inserts the map and all objects with fresh UUIDs,
revision zero and object versions one. Failure rolls everything back. Import bypasses
blank-map creation: exactly the supplied Spawn markers are imported (including none).
History starts empty; subsequent editing uses normal operations and collaboration.

Map names are case-insensitively unique in the existing database. On collision, import
uses `Name (Imported)`, then `Name (Imported 2)`, etc., truncating the base only if
necessary to respect the existing 200-character name limit.

Only after successful import does the client load the new map and apply its five
workspace preferences and camera. Existing local Debug preferences remain unchanged.
Camera zoom outside 0.05–8.0 is rejected, not clamped. Failed file validation, unsupported
format versions, and failed requests show an in-app error without applying settings.

## Safety limits

- Maximum file/request: 64 MiB (checked before browser file reading and on the server).
- Terrain strokes: 100,000; paths, markers and labels: 25,000 each.
- Geometry: 20,000 points per object, 2,000,000 points in total.
- Finite coordinates: ±1,000,000,000; unique order keys: 0 through MAX_SAFE_INTEGER−1.
- Strings: map name 200, marker caption 500, note 10,000, label text 1,000 characters.
- Brush/path width: positive, at most 100,000; marker scale: positive, at most 10;
  label font size: positive, at most 1,000; reference zoom: positive, at most 8;
  rotations/directions: 0 inclusive through 360 exclusive.

These limits leave substantial room above the audited local dataset (105 terrain
strokes and 6,111 terrain points, approximately 213 KB of stored terrain geometry),
while bounding parsing and geometry allocation. Existing per-object validation limits
are retained. Both schema/count limits and the byte limit apply.

Run `npm run verify:import-export` for deterministic round-trip, rollback, API,
fresh-ID, chronology, clean-history and no-Spawn checks.
