# Maps

The **Maps** tile of DAME HUB: knowledge maps, flowcharts, piping and wiring maps. A map is a tree of branches with notes, special notes
and links, read on a free-flow map or as an outline, verified branch by branch, with history and a trash.
Served at `/maps/`; opens inside the DAME app after sign-in. Login, users, rights and theme come from the core at `/dame-hub/core/v1/`.

Public repository, code only: no internal data, keys or real files. Data lives in Supabase, schema `maps`, reached through
`public.maps_*` functions (`db/maps/`). Starter templates in `templates/` are generic and invented.

What it does, rights, data and decisions: `docs/TILE.md`. Where it stands: `docs/STATUS.md`.
Rule book: `docs/SECURITY.md`, `docs/STANDARDS.md`, `docs/TILE-CONTRACT.md` in the admin repo `dame-hub`.
