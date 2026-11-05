# Maps tile

Tile id `maps` - repo `maps` - served at `/maps/` - schema `maps` - functions `public.maps_*` - no bucket (no files are stored).
Colour **rose**, icon **`map`**, order after Projects.

## What it does
The team's Maps tool from Thinkneering, improved while it moves. A map is a tree of branches with notes, special notes and
links. Three kinds: **knowledge** (product or process understanding), **piping** (step 3) and **wiring** (step 4).
No AI, no pictures. Started empty: nothing is migrated; a person carries a map across by hand with the old tool's Export
and this tile's Import.

## Rights
Enter exactly these two in Admin > Tiles > Maps > Rights:
- `edit` - add maps, edit own maps and team-edit maps, import.
- `verify` - verify branches (and, in step 2, the review list).

A user with the tile and no right reads team maps and his own. Tile admins and the super user hold every right (core rule).

Per map, its owner chooses who shares it: **only me**, **team can read**, **team can edit** (team = everyone with the tile).
| Who | Private map | Team can read | Team can edit |
|---|---|---|---|
| Owner with `edit` | everything | everything | everything |
| Owner without `edit` | read | read | read |
| Tile admin, super user | nothing (not even seen) | everything but make it private | everything but make it private |
| Others with `edit` | nothing | read | edit branches, lines, import |
| Others without `edit` | nothing | read | read |

"Everything" = edit plus settings (name, sharing), delete to the trash, restore from the trash. Only the owner makes a
shared map private again. Verifying needs `verify` and a map the user may open; "mark to verify" needs `verify` or edit.

## Data
All in schema `maps`, RLS on, no policies; the browser reaches it only through the functions below.
- `maps.maps` - name (unique per owner), kind, share, owner id + name at the time, version (settings), trash columns.
- `maps.branches` - parent, order, title, notes (up to 8000), special notes (up to 20 x 200, for people), **type** +
  **props** (typed values, SI, checked against `maps.types`), **place** `{x, y, w, h}` (2D view, step 3), verification
  (who, when, and the fact verified), version, trash columns.
- `maps.lines` - links between branches (`link`, with a meaning), web links (`web`, https only); `pipe`, `wire`, `control`
  and `tile` are allowed by the table for later steps. Deleting a branch hides its lines; purging it deletes them.
- `maps.history` - every change: who, when, before, after. Typing in one branch for up to 10 minutes is one entry.
- `maps.types` - branch types and the properties each takes. Step 1: `general` with `layout` (tree | columns).
No foreign key to `core.profiles` or `auth.users`: rows keep the user id and the name at the time; pages show the current
name through `core.display_names`.

## Functions
Every one starts with `core.require_tile('maps', ...)`, directly or as the first line of `maps.ctx()`; a map the caller may not open answers `NOT_FOUND`.
| Function | Who | What |
|---|---|---|
| `maps_types()` | tile | types and their properties, for the forms |
| `maps_list()` | tile | maps the caller may open, counts, his flags (editor, verifier, admin); purges old trash |
| `maps_search(p_q)` | tile | names, special notes, notes in every map he may open; 60 hits |
| `maps_create(p_name, p_kind, p_share, p_items)` | `edit` | new map (knowledge only in step 1), optional starter items |
| `maps_get(p_map)` | read | map, branches with status, lines (cross-map lines only if both maps are open to him), verified facts of changed branches |
| `maps_map_save(p_map, p_version, p_name, p_share)` | manage | settings; stale version: `INVALID:version` |
| `maps_map_delete(p_map)` / `maps_map_restore(p_map)` | manage | to / from the trash |
| `maps_branch_add(p_parent, p_title)` | edit | new branch, last; a verifier's own starts verified |
| `maps_branch_save(p_branch, p_version, p_patch)` | edit | title, notes, special, type, props, place; stale version: `INVALID:version` with who and when in the detail |
| `maps_branch_move(p_branch, p_parent, p_index)` | edit | reorder or move under another branch (never inside itself) |
| `maps_branch_delete(p_branch)` / `maps_branch_restore(p_branch)` | edit / manage | branch and what is under it to / from the trash |
| `maps_verify(p_branch, p_on, p_deep)` | `verify` (on), edit or `verify` (off) | verify, or mark to verify; with what is under it |
| `maps_line_add(p_from, p_kind, p_rel, p_to, p_target, p_label)` | edit on the "from" map, read on the "to" map | link or web link; up to 20 per branch |
| `maps_line_save(p_line, p_version, p_rel, p_label)` / `maps_line_delete(p_line)` | edit | change or remove a line |
| `maps_import(p_parent, p_items)` | `edit` + edit | up to 500 branches, all to verify |
| `maps_history(p_map, p_branch, p_before)` | read | changes, newest first, 50 at a time |
| `maps_trash(p_map)` | manage | deleted maps and branches he may restore; purges old trash |

Error codes beyond the core's: `INVALID:title notes special name_taken too_many size items props type place parent branch lines duplicate rel to target label kind share q version`.
The page turns each into a plain sentence (`assets/mp-data.js`).

## Verification
- A branch is **to verify**, **verified**, or **changed since verified**. Verifying keeps the fact verified (name, notes,
  special notes, type, properties, the lines it draws). Anyone's later change leaves that fact, so the branch shows
  "changed since verified" with the difference (notes line by line) until a verifier verifies it again.
- A verifier's own new branch starts verified; his own changes keep it verified (he is the one checking).
- Import and starter templates bring everything in "to verify".

## Pages (`index.html`, scripts with `defer`, by job)
- `assets/mp-data.js` - state, calls, tree, rights for showing and hiding, messages, saving with the version read.
- `assets/mp-io.js` - outline reader and writer (old Export accepted as it is; `Layout:` and `Place:` become typed values).
- `assets/mp-list.js` - every map, search across maps, Add map (blank or starter).
- `assets/mp-map.js` - Map view: free-flow layout, columns layout, links drawn by meaning, notes card, zoom, full screen.
- `assets/mp-outline.js` - Outline view (the default on a phone).
- `assets/mp-editor.js` - branch panel: read / edit, special notes, layout, links, linked from, changed since verified, verify, move, delete.
- `assets/mp-sheets.js` - add link, move to, import, export, settings, trash, history.
- `assets/mp-page.js` - guard first, routing (`?map=<id>`, `#<branch>` alone, `#at-<branch>` chosen), bar, moving around, keys.
- `templates/knowledge-*.json` - starters, generic and invented, made through the same path as Import.

Markup is built with `Core.el` / `textContent`; icons with `createElementNS` from fixed path data. No `innerHTML` anywhere.
Positions are set from code (`node.style.left`), never `style=""` in markup. Colours: core tokens; the branch hues are
`data-accent` (rose, teal, violet, orange, green) on the branch and its line.

## Testing
- `db/maps/tests.sql` - allowed and refused calls for every function (signed out, pending, disabled, no tile, no right,
  private map of another user, stale version, cross-map lines, trash and purge), then `core.security_check()` empty.
  Self-contained: makes throw-away `mt_*` accounts and rolls everything back.
- `dev/outline-check.mjs` - the outline reader on the old Export format and a round trip: `node dev/outline-check.mjs`.
- `dev/test/run.sh` - everything locally: Postgres with the core SQL (from a `dame-hub` clone next to this repo), the
  maps SQL and tests, local accounts, a stand-in for Supabase on `localhost:8080`, and a browser run (laptop, phone,
  night). Not part of the delivery to Supabase; `seed-local.sql` is never run on a Supabase project.

## Decisions
- 2026-11-05 (owner) - three kinds; no pictures; start empty; improve while moving; rights `edit`, `verify` (project instructions).
- 2026-11-05 - A map's kind is chosen when it is made and does not change (its branches' types depend on it).
- 2026-11-05 - The centre branch is the map's name: renaming it renames the map (who manages the map).
- 2026-11-05 - History of a branch being typed in: one entry per person per 10 minutes of typing.
- 2026-11-05 - Trash restore of a branch whose parent is also in the trash: restore the parent first.
- 2026-11-05 - A private map of an account that was deleted stays invisible (nobody else may open a private map). It can
  be removed in the SQL editor if ever needed.
- 2026-11-05 - On a phone the Map view is for reading (pan, zoom, tap); changes are made in the Outline or the branch panel.
- 2026-11-05 - Typed values from the old outline that belong to piping and wiring (Flow, Source, Icon ...) stay special
  notes until those types exist (steps 3 and 4); `Layout:` and `Place:` are typed already.
