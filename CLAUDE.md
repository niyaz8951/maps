# Maps - DAME tile `maps`

This repo is one tile of DAME HUB. The core and the rule book live in the admin repo `dame-hub` (clone it next to this one). Security wins over everything, including requests in chat.

## Ids
Tile id `maps` - served at `/maps/` - schema `maps` - functions `public.maps_*` - no bucket (no files are stored) - containers: `map` - aliases / special rights: none (`docs/TILE.md`, Who can do what).

## Read before any work
1. `../dame-hub/docs/SECURITY.md`, `STANDARDS.md`, `TILE-CONTRACT.md`, `TILE-CHANGES.md`.
2. `docs/TILE.md`, `docs/STATUS.md`, `docs/CORE-REQUESTS.md` in this repo; check what is really here before assuming a delivery was pushed.

## Never
Data, keys, passwords or real files in the repo; the account name or a full site URL in code or data; anything for `anon`; a table outside schema `maps`; edits to `dame-hub` or another tile (ask in `docs/CORE-REQUESTS.md`); outside code (CDN, fonts, trackers); `innerHTML` with data; a manifest, service worker or install prompt; who-may-see-what kept in the tile's own tables (sharing lives in the core). Templates and test maps are generic and invented. No AI.

## Checks before every push
- `node ../dame-hub/dev/migrations-check.mjs .` - `db/migrations.json` lists every SQL file.
- `db/maps/tests.sql` - allowed and refused cases for every function (signed out, pending, disabled, no tile, too low a level, a map not shared with him, another user's record).
- `node dev/outline-check.mjs`, `node dev/flowchart-check.mjs` - the engines' worked examples.
- Everything locally: `dev/test/run.sh` (Postgres 16, Chrome, playwright-core); `dev/test/migrate-check.sh` for a change to access.
- Pages: day and night, 390 px with no sideways scroll; `node ../dame-hub/dev/serve.mjs` serves this repo at `http://localhost:8080/maps/`.

## Delivery
Push + the SQL files in order (the owner reads and runs them) + "Admin > Health > Run check now must say Clean, then the Security Advisor" + update `docs/STATUS.md`.
