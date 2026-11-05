# Maps status

Chats that start with **DAME-MAPS** continue from here.

## Now
- 2026-11-05 - **Step 1 checked by the owner.** `001` and `002` applied on live. Next: step 2 (or flowcharts first, if the
  owner chooses).
- 2026-11-05 - **Step 1 delivered: foundation and knowledge maps.** Waiting for the owner's check (below). The tile stays
  off for everyone else until it passes.
  - Schema `maps`: maps, branches with type / typed properties / place, lines, history, trash (30 days), versions,
    types registry (`db/maps/001_init.sql`). Tests: `db/maps/tests.sql`.
  - Pages: list, search across maps, Add map (blank, Product breakdown or Process starter), Map and Outline views,
    Read / Edit, branch panel (name, notes, special notes, layout, links to branches in this or another map, web links,
    linked from), move (up, down, to another branch), delete to the trash and restore, share, verify and "changed since
    verified" with the difference, history (map and branch), edit clash guard, Import (old outline as it is) and Export,
    phone layout (Outline first), day and night.
  - Checked locally: database tests, outline check, browser run on a laptop and a phone width, day and night
    (`dev/test/run.sh`): all pass, no console or CSP errors.

- 2026-11-05 - **Flowcharts added as a fourth kind** (owner). `db/maps/002_flowchart_ready.sql`: the schema accepts them
  now (kind `flowchart`, line kind `flow` with its label, ten shapes with a `lane`); no screens until step 3. Creating a
  flowchart map and drawing `flow` lines stay refused (`INVALID:kind`) until then. Tests added; all pass locally.

## SQL applied
| File | Live | Staging |
|---|---|---|
| `db/maps/001_init.sql` | 2026-11-05 | - (no staging project) |
| `db/maps/002_flowchart_ready.sql` | 2026-11-05 | - |

## Owner, to apply and check step 1
1. Admin > Tiles > Maps: rights exactly `edit, verify` (as registered). Leave it **off** for now.
2. SQL editor: paste `db/maps/001_init.sql` whole and run, then `db/maps/002_flowchart_ready.sql` the same way (002 also
   works if 001 already ran on its own). Then `select * from core.security_check();` - no rows. Security
   Advisor: no errors.
3. `db/maps/tests.sql`: run it whole. It makes its own throw-away accounts, switches the tile on inside the test only and
   rolls everything back; it must end with `ALL MAPS TESTS PASSED`. (There is no staging project yet; your call whether
   to run it on live. Nothing stays behind.)
4. Admin > Tiles > Maps: switch it **on**, with access only for yourself, to try it. Then on a laptop and a phone, day and night:
   - Add map "Test" from the Product breakdown starter. It opens in Edit; every starter branch is "to verify".
   - Click branches (one click opens the next level and closes the rest; Ctrl + click opens one more); double-click reads;
     on a branch with nothing under it the notes card opens on the map.
   - Choose a branch, press Tab, name the new branch, write notes, add a special note. Add a link to another branch
     ("Requires") and a web link (an http:// one is refused). Click the branch on the map: the link is drawn with its words.
   - Components: in the panel set Layout to Columns; the map draws its branches side by side.
   - Import: paste an Export from the old Maps tool (Thinkneering) under the centre. Its `Layout:` and `Place:` lines
     become values; every other special note stays as it was.
   - Delete a branch (Delete key or the panel), find it in Trash, restore it. History shows both.
   - Mark a branch verified; change its notes; it shows "Changed since verified" with the old and new lines.
   - Open the same branch in two browsers (or a laptop and a phone), type in both: the second save says who changed it
     and offers Copy my text / Reload.
   - Export: copy or download; Map settings: share with the team, rename, delete the map and restore it from the list's Trash.
   - Phone: the map opens on the Outline; the Map view pans and zooms; a tap on a chosen branch opens it full screen.
5. When it is right: give access to the team (Access to Maps in the account menu) with `edit` / `verify` as each needs,
   and tell this project "step 1 checked".

## Next
1. Step 2 - knowledge extras: review list for verifiers, "linked from" across maps on the map, links to other tiles,
   more starter templates, print of a branch or a map (A4 outline).
2. Step 3 - flowcharts: Start / End, Process, Decision, Input / Output, Document, Manual step, Wait, Sub-process,
   Connector (ISO 5807); swimlanes; arrows with labels (Yes / No); auto layout top to bottom with right-angled arrows;
   **drag to place** (saved in `place`), shared later by piping's 2D view; checks (one Start, an End, every step
   reachable, no dead ends, every decision exit labelled); walk through and every path; links to piping / wiring
   branches; Import of text outline and a Mermaid subset, Export SVG / print / Excel / Mermaid; starters (approval,
   fault finding, start / stop sequence); phone: Outline with exits, chart read-only.
3. Step 4 - piping. 4. Step 5 - wiring (see the project instructions, "Scope").

## Notes for the next steps
- New branch types and their properties go into `maps.types` with a new SQL file; `maps.clean_props` checks them and the
  forms read them from `maps_types()`. The outline reader (`assets/mp-io.js`, `KEYS`) gets the old special-note keys
  (Flow, Leaving, Source, Pump head, Switch, Icon ...) for those types; until then they stay special notes.
- `maps_create` accepts only `knowledge`; steps 3, 4 and 5 replace it to allow `flowchart`, `piping` and `wiring`.
- `maps_line_add` accepts `link` and `web`; later files add `flow` (step 3: same map only, rel `next`, label = the
  answer), `pipe`, `wire`, `control`, `tile` (the table already allows them).
- Flowchart lane order: a typed property on the centre branch in step 3 (a new `maps.types` row or prop, no table change).
- The engines, symbols and their checks (Thinkneering `mp-water.js`, `mp-power.js`, `mp-flow.js`, `mp-schematic.js`,
  `mp-signs.js`, `scripts/mp-*-check.mjs`) come over in steps 3 and 4, reading typed values instead of special notes.

## Changes from the core this tile follows
- 2026-11-05 installed app: head block with `viewport-fit=cover` and `theme-color` (done in `index.html`).
- 2026-11-05 accounts can be renamed and deleted: keyed by user id, names from `core.display_names`, no foreign keys
  to accounts; tests insert `auth.sessions` before `core_session_start()` (done).
