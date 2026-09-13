# Valheim Map

A small, self-hosted foundation for a two-player Valheim map. The biome terrain editor and REST persistence are implemented; collaboration and the remaining map-object editors are intentionally deferred.

## Architecture

- React and Vite provide the frontend.
- One Fastify/Node.js process serves the compiled frontend and the HTTP API. The Fastify WebSocket plugin is registered for future collaboration routes, but no WebSocket route exists yet.
- SQLite is the sole data store, at `/data/valheim-map.sqlite` inside the container.
- The Compose project is named `valheim-map` and has one project-scoped bridge network. Only the application HTTP port is published to the host.
- Schema migrations are version-controlled TypeScript in `server/db/migrations.ts`. The schema stores semantic map data rather than rendered pixels: maps, shared object metadata, biome strokes, paths, markers, labels, and an append-only accepted-operation log.
- Map geometry uses zoom-independent world coordinates. Freehand strokes and paths use compact JSON point arrays; objects retain stable UUID v4 IDs, bounding boxes, ordering keys, timestamps, soft-deletion state, and optimistic-concurrency versions.
- Shared domain types live in `shared/domain.ts`, so future client and server map features use the same model.

## Prepared V1 object model

Migration 3 prepares the semantic schema without adding non-terrain object UI. `lava` is a biome and is classified as land. The biome selector order is Ocean, Meadows, Black Forest, Swamp, Mountains, Plains, Mistlands, Ashlands, Lava, then Deep North.

Markers retain their world position, optional visible caption (`name`), optional note, ordering key, and soft-deletion state. They also carry a positive `size_scale` and optional `direction_degrees` in `[0, 360)` for directional markers such as Vegvisir. Marker types remain unrestricted text. The intended initial keys are `death_skull`, `boss`, `trader`, `pet`, `home`, `campfire`, `circle`, `red_cross`, `green_tick`, `tent`, `castle`, `dragon_egg`, `chest`, `portal`, `cave`, `village`, `berry`, `tree`, `mining`, `crypt`, `structure`, `farming_garden`, `tar_pool`, `tower`, `fortress`, `ship`, `spawn`, `maypole`, `sap`, `signpost`, and `vegvisir`. Later-created markers render above earlier markers through the existing `layer`, then `order_key` ordering.

Paths have a semantic `path_type` (`path`, `road`, `river`, or `sailing_route`) and `geometry_type` (`freehand`, `straight`, or `curve`). Geometry remains compact world-coordinate JSON points: freehand uses simplified points, straight uses start/end, and curve uses start/control/end; exact point counts will be validated in the service layer. Paths render in `MapLayer.Paths`, below `MapLayer.Markers`, in creation order. The planned visual is dotted, and the planned Paths visibility toggle is UI state rather than a stored per-path value.

The temporary grid remains unsaved rendering/UI state; its next visual refinement should increase opacity slightly.

## Persistence API

The server provides the authoritative REST persistence layer. Routes delegate to a shared service layer, which owns SQLite transactions, semantic validation, authoritative layer/order/version assignment, bounds calculation, soft deletion, and append-only accepted-operation logging. This same service is intended for future WebSocket handlers.

- `GET /api/maps`, `POST /api/maps`, `PATCH /api/maps/:mapId`, and `DELETE /api/maps/:mapId` manage active maps.
- `POST /api/maps/:mapId/duplicate` clones active current state with new map/object IDs, retaining relative ordering but not operation history.
- `GET /api/maps/:mapId` returns the active map and current active objects in `layer`, then `orderKey` order.
- `POST /api/maps/:mapId/objects`, `PUT`/`DELETE /api/maps/:mapId/objects/:objectId`, and `POST /api/maps/:mapId/objects/:objectId/restore` persist semantic biome strokes, paths, markers, and labels.

Object mutations require UUID `actorId` and `clientOperationId`; updates, deletes, and restores also require `baseObjectVersion`. Accepted mutations are atomic, advance the map revision once, and log a `{ before, after }` payload. Reusing an accepted actor/client operation ID returns the prior accepted result without applying it twice. The server derives layers, render order, versions, timestamps, and bounds rather than accepting them from clients.

## Current viewport foundation

The frontend currently provides an empty PixiJS infinite canvas with panning and cursor-centred wheel/trackpad zoom. The camera stores the world coordinate at the viewport centre plus a zoom factor; map content remains in world coordinates and is not tied to device pixels. Zoom is clamped from 10% to 800%, with 100% as the default. The temporary origin marker, north indicator, and debug readout are navigation aids only.

Controls: left or middle drag pans (Space + left drag is also supported), mouse wheel/trackpad zooms at the cursor, and the minimal overlay controls reset the view or return the current view to 100%.

## Current biome terrain editor

The frontend bootstraps one current map through the REST API. It reuses a browser-local anonymous actor UUID and remembers the selected map ID; on an empty database it creates `Our World`. It loads active objects before enabling drawing, so a load failure never looks like an empty editable map. Completed paint and erase gestures receive immediate optimistic feedback, then are reconciled with the authoritative returned object. A failed save removes the pending stroke and reports a small error. Browser terrain remains deliberately limited to biome strokes; paths, markers, and labels are loaded as state but have no UI or renderer yet.

Terrain is composited in `layer`, then `orderKey` order into a transparent viewport render texture above a parchment layer. Erase strokes use Pixi's `erase` blend mode rather than modifying prior paint geometry, so a subsequent paint stroke can restore terrain. Completed strokes persist as semantic world-coordinate objects and reappear after a refresh.

Biome tiles are opaque cached canvas textures. Their tile position is derived from world coordinates, so a biome's pattern stays continuous when strokes meet, while panning or zooming. Final base / mark palette: Ocean `#B7CDD2` / `#6F929E`; Meadows `#91A96B` / `#6F8754`; Black Forest `#365E4B` / `#244536`; Swamp `#78684B` / `#584C38`; Mountains `#D9DEE1` / `#A4ADB4` with snow `#F4F7F7`; Plains `#C4A75E` / `#9B7F3F`; Mistlands `#81798D` / `#625A70`; Ashlands `#924E3E` / `#5F332B`; Lava `#D79A35` / `#A64B27`; Deep North `#5F8396` / `#B7CDD2`.

The temporary Grid control draws an unsaved world-anchored navigation grid above terrain. Coastlines are generated from a separate final-state land/Ocean classification render pass, so they appear only at land/Ocean boundaries and never around individual strokes or between land biomes.

## Local development

Prerequisite: Node.js 24 or newer.

```sh
npm install
npm run dev
```

Vite is available at `http://localhost:5173` and proxies `/api` requests to Fastify at `http://localhost:3000`.
Unless `DATABASE_PATH` is explicitly set, local development stores SQLite data at
`./data/valheim-map.sqlite` (resolved from the project working directory). This
runtime directory is ignored by Git. Docker explicitly overrides the path to
`/data/valheim-map.sqlite`.

Useful checks:

```sh
npm run typecheck
npm run verify:api
npm run build
```

## Docker deployment (UNRAID)

1. Copy `.env.example` to `.env`.
2. Set `VALHEIM_MAP_DATA_DIR` to a persistent host directory, such as `/mnt/user/appdata/valheim-map`. The directory must be writable by container UID/GID `10001` (on UNRAID, set suitable ownership or permissions when creating it).
3. Optionally change `VALHEIM_MAP_PORT`.
4. Start the isolated stack:

```sh
docker compose up --build -d
```

The application is then available at `http://<host>:<VALHEIM_MAP_PORT>`. SQLite data, including WAL files, stays entirely in the configured host directory mounted at `/data`.

Check status with:

```sh
docker compose ps
curl http://localhost:3000/api/health
```

The health endpoint returns JSON such as:

```json
{"status":"ok","database":"available"}
```
