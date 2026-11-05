# Maps tile

Tile id `maps` - repo `maps` - served at `/maps/` - schema `maps` - functions `public.maps_*` - no bucket (no files are stored).
Colour **rose**, icon **`map`**, order after Projects.

## What it does
The team's Maps tool from Thinkneering, improved while it moves. A map is a tree of branches with notes, special notes and
links. Four kinds: **knowledge** (product or process understanding), **flowchart** (steps in ISO 5807 shapes joined by
arrows, in lanes; set as a **Flowchart** or a **Process flow**; built), **piping** (step 4) and **wiring** (step 5).
No AI, no pictures. Started empty: nothing is migrated; a person carries a map across by hand with the old tool's Export
and this tile's Import.

## Rights
Enter exactly these two in Admin > Tiles > Maps > Rights:
- `edit` - add maps, edit own maps and team-edit maps, import.
- `verify` - verify branches (and, in step 2, the review list).

A user with the tile and no right reads team maps and his own. Tile admins and the super user hold every right (core rule).
`verify` also opens **Review** (every branch to verify in the maps he may open) and **Send back** with a comment.

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
  **props** (typed values, SI, checked against `maps.types`), **place** `{x, y, w, h}` (a flowchart step put by hand;
  the 2D view in step 4), verification (who, when, and the fact verified), a verifier's **review** comment (who, when,
  why, the version it was sent back at), version, trash columns. In a flowchart every step sits under the centre.
- `maps.lines` - links between branches (`link`, with a meaning), web links (`web`, https only), links to a page of
  another tile (`tile`, target `<tile-id>/<path>`, opened at `/<tile-id>/...`), flowchart arrows (`flow`, same map,
  label = the answer, up to 40; rel `next`, or `reply` for an answer back, drawn dashed beside it; never to or from a
  Note); `pipe`, `wire`, `control` are allowed by the table for later steps. Deleting a branch hides its lines; purging it deletes them.
- `maps.history` - every change: who, when, before, after. Typing in one branch for up to 10 minutes is one entry.
- `maps.types` - branch types and the properties each takes. Step 1: `general` with `layout` (tree | columns). 002:
  flowchart shapes `start`, `end`, `process`, `decision`, `data` (Input / Output), `document`, `manual`, `delay` (Wait),
  `subprocess`, `connector`, each with `lane` (text, up to 40). 003: `general` also takes `lanes` (a list, up to 12 x 40):
  the lanes of a flowchart in order, kept on its centre. 005: every shape also takes `group` (text, up to 40) and
  `show_notes` (bool); a `note` shape (no properties); `general` takes `style` (`flowchart` | `process`).
No foreign key to `core.profiles` or `auth.users`: rows keep the user id and the name at the time; pages show the current
name through `core.display_names`.

## Functions
Every one starts with `core.require_tile('maps', ...)`, directly or as the first line of `maps.ctx()`; a map the caller may not open answers `NOT_FOUND`.
| Function | Who | What |
|---|---|---|
| `maps_types()` | tile | types and their properties, for the forms |
| `maps_list()` | tile | maps the caller may open, counts, his flags (editor, verifier, admin); purges old trash |
| `maps_search(p_q)` | tile | names, special notes, notes in every map he may open; 60 hits |
| `maps_create(p_name, p_kind, p_share, p_items)` | `edit` | new knowledge map or flowchart, optional starter items (a flowchart keeps its lanes in the order first used) |
| `maps_get(p_map)` | read | map, branches with status, lines (cross-map lines only if both maps are open to him), verified facts of changed branches |
| `maps_map_save(p_map, p_version, p_name, p_share)` | manage | settings; stale version: `INVALID:version` |
| `maps_map_delete(p_map)` / `maps_map_restore(p_map)` | manage | to / from the trash |
| `maps_branch_add(p_parent, p_title)` | edit | new branch, last (in a flowchart: a Process step, under the centre only); a verifier's own starts verified |
| `maps_branch_save(p_branch, p_version, p_patch)` | edit | title, notes, special, type, props, place; stale version: `INVALID:version` with who and when in the detail |
| `maps_branch_move(p_branch, p_parent, p_index)` | edit | reorder or move under another branch (never inside itself; flowchart steps stay under the centre) |
| `maps_branch_delete(p_branch)` / `maps_branch_restore(p_branch)` | edit / manage | branch and what is under it to / from the trash |
| `maps_verify(p_branch, p_on, p_deep)` | `verify` (on), edit or `verify` (off) | verify (clears a send-back comment), or mark to verify; with what is under it |
| `maps_review()` | `verify` | every branch to verify or changed since verified, in every map he may open; 300 at most |
| `maps_send_back(p_branch, p_comment)` | `verify` | back to "to verify" with why (1 to 500 characters) |
| `maps_line_add(p_from, p_kind, p_rel, p_to, p_target, p_label)` | edit on the "from" map, read on the "to" map | link, web link, tile link, or arrow (flowchart, same map, one per pair, never the centre); up to 20 per branch |
| `maps_line_save(p_line, p_version, p_rel, p_label)` / `maps_line_delete(p_line)` | edit | change or remove a line |
| `maps_import(p_parent, p_items)` | `edit` + edit | up to 500 branches, all to verify; in a flowchart under the centre, flat, with arrows by `key` / `next` |
| `maps_history(p_map, p_branch, p_before)` | read | changes, newest first, 50 at a time |
| `maps_trash(p_map)` | manage | deleted maps and branches he may restore; purges old trash |

Error codes beyond the core's: `INVALID:title notes special name_taken too_many size items props type place parent branch lines duplicate rel to target label kind share q version comment`.
The page turns each into a plain sentence (`assets/mp-data.js`).

## Verification
- A branch is **to verify**, **verified**, or **changed since verified**. Verifying keeps the fact verified (name, notes,
  special notes, type, properties, the lines it draws). Anyone's later change leaves that fact, so the branch shows
  "changed since verified" with the difference (notes line by line) until a verifier verifies it again.
- A verifier's own new branch starts verified; his own changes keep it verified (he is the one checking).
- Import and starter templates bring everything in "to verify".

## Pages (`index.html`, scripts with `defer`, by job)
- `assets/mp-data.js` - state, calls, tree, rights for showing and hiding, messages, saving with the version read.
- `assets/mp-io.js` - outline reader and writer (old Export accepted as it is; `Layout:` and `Place:` become typed values;
  in a flowchart also `Shape:`, `Lane:`, `Next: <answer> -> <step>` and the centre's `Lanes:`).
- `assets/mp-fc.js` - the flowchart engine, no page: layout (ranks, lanes, places), arrow routing round steps, check,
  ways through, Mermaid in and out. Runs in node too (`dev/flowchart-check.mjs`).
- `assets/mp-chart.js` - the flowchart view: SVG on the map's canvas, drag to place, drag to connect, the bar (add,
  lanes, auto layout, check, walk through, ways through), the flowchart Outline, SVG / Excel / print out.
- `assets/xlsx-lite.js` - the old tool's own Excel writer, brought over as it is (no library).
- `assets/mp-list.js` - every map, search across maps, Add map (knowledge or flowchart, blank or starter), Review.
- `assets/mp-map.js` - Map view: free-flow layout, columns layout, links drawn by meaning, notes card, zoom, full screen.
- `assets/mp-outline.js` - Outline view (the default on a phone).
- `assets/mp-editor.js` - branch panel: read / edit, special notes, layout, links, linked from, changed since verified, verify, move, delete.
- `assets/mp-sheets.js` - add link, move to, import, export, settings, trash, history.
- `assets/mp-page.js` - guard first, routing (`?map=<id>`, `#<branch>` alone, `#at-<branch>` chosen), bar, moving around, keys.
- `templates/knowledge-*.json`, `templates/flowchart-*.json` - starters, generic and invented, made through the same path
  as Import (every flowchart starter passes the check with no problem and no warning).

Markup is built with `Core.el` / `textContent`; icons with `createElementNS` from fixed path data. No `innerHTML` anywhere.
Positions are set from code (`node.style.left`), never `style=""` in markup. Colours: core tokens; the branch hues are
`data-accent` (rose, teal, violet, orange, green) on the branch and its line.

## Testing
- `db/maps/tests.sql` - allowed and refused calls for every function (signed out, pending, disabled, no tile, no right,
  private map of another user, stale version, cross-map lines, trash and purge), then `core.security_check()` empty.
  Self-contained: makes throw-away `mt_*` accounts and rolls everything back.
- `dev/outline-check.mjs` - the outline reader on the old Export format and a round trip: `node dev/outline-check.mjs`.
- `dev/flowchart-check.mjs` - worked examples for the flowchart engine (layout, routing round steps, drag-to-place
  places, checks, ways through, Mermaid in / out and round trip, outline round trip, every starter):
  `node dev/flowchart-check.mjs`.
- `dev/test/run.sh` - everything locally: Postgres with the core SQL (from a `dame-hub` clone next to this repo), the
  maps SQL and tests, local accounts, a stand-in for Supabase on `localhost:8080`, and a browser run (laptop, phone,
  night). Not part of the delivery to Supabase; `seed-local.sql` is never run on a Supabase project.

## Decisions
- 2026-11-05 (owner) - **Process flow**: a flowchart may be set as a process flow (e.g. an escalation ladder). It adds
  reply arrows, notes shown in the box, a Note shape, groups with a bracket; Start and End become optional. A starter
  with two boxes only. Mermaid dashed arrows are replies; braces are Notes. A reply has no part in the order top to
  bottom, the checks or the ways through; it is drawn beside the arrow it answers when there is one.
- 2026-11-05 (owner) - Steps 2 and 3 delivered together, flowcharts first in the work.
- 2026-11-05 - A flowchart's steps are flat under its centre; the arrows are `flow` lines, so steps may branch, join and
  loop. A Decision's exit most nearly straight below leaves at the bottom, the others from the sides; loops go round on
  the right; an arrow tries a few right-angled routes and takes the first that crosses no step.
- 2026-11-05 - Drag to place snaps to a 10 grid; a step dropped in another lane moves to that lane; the lane order is
  saved on the centre before any lane change, so moving a step never reorders the lanes.
- 2026-11-05 - The check never blocks a save: problems and warnings are shown, the owner decides. "To verify" is the
  dashed outline (as on the knowledge map).
- 2026-11-05 - Mermaid: only lines understood from end to end are taken; anything else is listed, never guessed.
- 2026-11-05 - Sending back a branch makes it "to verify" with the comment until a verifier verifies it; "changed since"
  is the branch's version against the version it was sent back at.
- 2026-11-05 - A tile link keeps `<tile-id>/<path>` only; a full address pasted in is cut to that.
- 2026-11-05 - The drawing as a file (.svg) and on paper carries fixed neutral colours (a file has no theme, and paper is
  white); on screen the chart uses the theme tokens and the tile accent only, day and night.
- 2026-11-05 (owner) - **Flowcharts are a fourth kind.** The schema accepts them now (002, no screens); step 3 builds them
  (shapes, lanes, labelled arrows, auto layout, drag to place, checks, walk through, Import / Export incl. Mermaid);
  piping becomes step 4 and wiring step 5. Drag to place and line drawing are built here first and reused by piping's 2D view.
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
