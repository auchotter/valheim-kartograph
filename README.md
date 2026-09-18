# Valheim Kartograph v1.0

Private, self-hosted collaborative Valheim mapping for desktop and laptop browsers.

## Editing and navigation

- Semantic terrain painting/erasing across ten biomes, including Lava and Deep North. Chronological strokes remain data, not a flattened image. Brush diameter ranges linearly from 20–1000 world units.
- Dotted Freehand, Straight and Curve Paths with editable geometry and biome-aware contrast.
- 35 supported Marker types, captions, directional Vegvisir, and terrain-aware artwork. Helper textures are not separate Marker types; custom/unknown and retired development types are rejected.
- Standalone Text with rotation, size and persistent reference-zoom scaling. Captions and Text adapt contrast over Black Forest, Ashlands and Mistlands.
- Realtime collaboration, semantic Undo/Redo, multiple maps, rename, duplicate and delete.
- Coordinate Navigator, Grid, Reset View and cursor-centred zoom from 5%–800%. Map X is Valheim X; map Y is negative Valheim Z.
- Protect controls ordinary object interaction independently of creation. Marker, Path and Text have independent opacity preferences; selection temporarily displays an object at full opacity.

Use the toolbar and its displayed shortcuts. Space + drag or middle-button drag pans. Escape cancels the active tool/creation and returns to PAN unless a dirty field or transient popup consumes it first. Marker Gallery Escape closes the gallery and abandons placement in one press. Enter confirms selected-object edits. Newly placed Markers focus their caption field once creation succeeds. Debug's outer window closes using its explicit X control.

Desktop/laptop operation is the v1.0 priority; very narrow/mobile layouts are an accepted limitation.

## Portable maps

In Map Library, open the header `…` drawer and choose **IMPORT MAP** or **EXPORT CURRENT MAP**.

Exports are readable `application/json` files ending in `.valheim-kartograph.json`, with `format: "valheim-kartograph"`, `formatVersion: 1`, and application version `1.0`. They include active terrain chronology, Paths, canonical Markers/captions/directions, Text/reference zoom, all three opacities, Grid, Protect and camera. They exclude selection, drafts, Debug state, database IDs and operation history.

Import atomically creates an independent new map with fresh IDs and clean history. It never overwrites a map or injects Spawn; conflicting names receive an imported-name suffix. A genuine new blank map receives one Spawn at X0/Z0. Duplication preserves current content without adding Spawn. Files are limited to 64 MiB and validated on client and server.

Portable export is a per-map portability/backup tool, **not a complete server backup**: it does not retain Undo/Redo history or all maps in the database.

## Architecture and local development

Requires Node.js 24 or newer. React/TypeScript/Vite provide the interface, PixiJS renders the map, and one Fastify process serves the built client, REST API and WebSockets. SQLite (`better-sqlite3`) stores semantic objects and operations; shared Zod schemas validate data. REST owns mutations; WebSockets broadcast accepted changes, with snapshot recovery when needed.

```sh
npm ci
npm run dev
```

Vite runs at `http://localhost:5173` and proxies `/api`, including WebSockets, to Fastify on port 3000. The default database is `./data/valheim-map.sqlite`, relative to the working directory. Never point tests at a real database. Verification scripts use disposable databases.

```sh
npm run typecheck
npm run verify:api
npm run verify:import-export
npm run build
npm start
```

All regression commands are listed as `verify:*` in `package.json`. Production output is `dist/client`, `dist/server` and `dist/shared`. Configure `PORT` (default 3000), `HOST` (default `0.0.0.0`) and `DATABASE_PATH`. Vite copies the supplied PNGs from `client/public/markers` and bundles the ValheimNorse font from `client/src/assets/fonts`; do not edit generated assets.

## Docker / UNRAID

The multi-stage image uses Node 24 Alpine and runs as UID/GID **10001:10001**. SQLite is `/data/valheim-map.sqlite`. Compose retains project name `valheim-map`, one isolated bridge network, a host bind mount, and `restart: unless-stopped`.

1. Copy `.env.example` to `.env`.
2. Set `VALHEIM_MAP_DATA_DIR=/mnt/user/appdata/valheim-map` or your chosen persistent directory.
3. Prepare that directory so UID/GID 10001 can write it. For a **new dedicated directory** on the host:

   ```sh
   sudo mkdir -p /mnt/user/appdata/valheim-map
   sudo chown 10001:10001 /mnt/user/appdata/valheim-map
   sudo chmod 750 /mnt/user/appdata/valheim-map
   ```

   For existing data, stop the application and review database/sidecar ownership too. Image-layer ownership of `/data` does **not** fix an existing host bind mount. Do not apply broad permission changes to other appdata.
4. Optionally change `VALHEIM_MAP_PORT` (default 3000), then:

   ```sh
   docker compose build --no-cache
   docker compose up -d
   docker compose ps
   curl http://localhost:3000/api/health
   ```

Health returns `{"status":"ok","database":"available"}`. Open `http://<host>:<port>`. Compose publishes on available host interfaces by default: restrict access as below. The mounted directory must allow database, migration and WAL/SHM writes. Migrations run automatically at startup. Back up before updating; retain the previous image and matching database backup for recovery.

## Server backup and restore

SQLite uses **WAL**. Do not copy only `valheim-map.sqlite` while the app is writing: committed data may still be in `valheim-map.sqlite-wal`.

A simple safe backup procedure:

1. Run `docker compose stop app` and confirm the application has stopped.
2. Copy the entire dedicated data directory to a separate dated backup, including any `-wal` / `-shm` sidecars still present. Keep the files together as one snapshot. Clean shutdown normally checkpoints WAL, but do not assume sidecars can be discarded.
3. Run `docker compose start app` and check health.

To restore, stop the app, retain the current directory as a recovery copy, and restore the complete matching backup to the configured data directory. Never mix a restored database with unrelated old WAL files. Restore write access for UID/GID 10001, start the app and check health/maps. When rolling back an upgrade, use the application version matching the backup: migrations are forward-only. Test recovery using an isolated copy, never live data.

## Security

**Valheim Kartograph v1.0 has no authentication or authorisation. Anyone who can reach it can modify or delete maps.** Anonymous actor IDs are history/collaboration identifiers, not credentials. HTTP and WebSockets share this trust model.

Do **not** expose port 3000 directly to the public Internet. Use a trusted LAN, VPN, or authenticated/access-restricted reverse proxy protecting both HTTP and WebSockets. Use TLS for remote access and firewall the direct application port so the proxy cannot be bypassed. Input validation and import limits do not replace access control.
