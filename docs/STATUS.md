# Maps status

Chats that start with **DAME-MAPS** continue from here.

## Now
- 2026-11-05 - **Steps 2 and 3 delivered together** (owner: "push step 2 and 3 till flow charts asap"): flowcharts and the
  knowledge extras. Waiting for the owner's check (below).
  - **Flowcharts** (`db/maps/003_flowcharts.sql`, `assets/mp-fc.js`, `assets/mp-chart.js`): Add map > Flowchart (blank,
    approval, fault finding, start / stop sequence). Ten ISO 5807 shapes, lanes (swimlanes, in order), arrows with the
    answer on them. Auto layout top to bottom, lanes as columns, right-angled arrows that go round steps. **Drag to
    place** (Edit): a step stays where it is put (snapped to a 10 grid, saved with the clash guard; dropped in another lane
    it moves to that lane); drag the **+** under the chosen step onto another step for an arrow, or onto empty space for a
    new step there; dragging near the edge scrolls the chart. Auto layout forgets the places. Tab adds the next step.
    Step panel: shape, lane, answers (arrows out), arrows in, links. **Check** (problems, warnings, notes, each with Show),
    **Walk through** (from the Start, choose an answer at each decision, the way lights up), **Ways through** (every way
    to an End, loops and dead ends). Import: Mermaid (a subset) or the outline Export writes (Shape, Lane, Next lines).
    Export: Mermaid, outline, drawing (.svg, fixed colours), step list (.xlsx), print A4 / A3 landscape. Phone: the
    Outline lists each step with its answers; the chart is for reading (pan, zoom, tap).
  - **Knowledge extras** (`db/maps/004_review.sql`): **Review** on the list page for verifiers (every branch to verify
    across the maps they may open; Verify there, or **Send back** with a comment). The comment shows on the branch and on
    the map ("sent back") until a verifier verifies it, with "changed since" once someone has changed it. Links to a
    page of **another tile** (Add link > A page of another DAME tile: `projects/index.html`, opened at `/projects/...`,
    never stored as a full address). On the map, `← 2` marks a branch linked from other maps. Three more knowledge
    starters (equipment selection, troubleshooting guide, standard or specification). **Print** a branch or the map as an
    A4 outline (Export > Print, or the branch panel).
  - Checked locally (`dev/test/run.sh`): database tests (allowed and refused calls for every new function), engine
    checks (`node dev/flowchart-check.mjs`: 69 worked examples), outline check, browser runs on a laptop and a phone,
    day and night: all pass, no console or CSP errors, `core.security_check()` empty.
- 2026-11-05 - Step 1 checked by the owner. `001` and `002` applied on live.

## SQL applied
| File | Live | Staging |
|---|---|---|
| `db/maps/001_init.sql` | 2026-11-05 | - (no staging project) |
| `db/maps/002_flowchart_ready.sql` | 2026-11-05 | - |
| `db/maps/003_flowcharts.sql` | not yet | - |
| `db/maps/004_review.sql` | not yet | - |

## Owner, to apply and check steps 2 and 3
1. SQL editor: paste `db/maps/003_flowcharts.sql` whole and run; then `db/maps/004_review.sql` the same way. Then
   `select * from core.security_check();` - no rows. Security Advisor: no errors.
2. `db/maps/tests.sql`: run it whole; it rolls everything back and must end with `ALL MAPS TESTS PASSED`.
3. On a laptop (Edit on), day and night:
   - Add map > Start from > **Flowchart: approval with review and rework, in lanes**. Ten steps in three lanes; the bar
     says "Check: all good". Walk through it; open Ways through.
   - Drag a step a little: it stays (reload: still there). Drag it into the next lane: its lane changes.
   - Click a step, drag the **+** under it onto another step: an arrow. Drag it onto empty space: a new step there, its
     name ready to type. From a Decision you are asked the answer (Yes / No ...).
   - Double-click a step: change its shape and lane; add an answer; the check bar updates (try a Decision with one exit).
   - Click an answer on an arrow to change it or remove the arrow. Auto layout puts everything back.
   - Import into a new blank flowchart a Mermaid flowchart (e.g. from another tool):
     `flowchart TD` / `A([Start]) --> B{Pump running?}` / `B -->|Yes| C[Check the strainer]` / `B -->|No| D[/Read the trip code/]`.
   - Export: Mermaid, the drawing (.svg), the step list (.xlsx), Print A3 (choose "Save as PDF" to get a PDF).
   - A knowledge map: Add link > A page of another DAME tile (e.g. `projects`); it opens that tile. Send a branch back
     with a comment; on the list page, **Review** shows it with the comment; Verify it there. Export > Print (A4).
4. On a phone: open the flowchart: the Outline with each step's answers, the check bar; the Map tab pans and zooms.
5. Tell this project "steps 2 and 3 checked", and anything that should work differently.

## Next
1. Step 4 - piping: types and forms, pipes, Chilled water template, water engine, Flow view, 2D view with drag to place
   (reusing the flowchart's drag, grid and arrow routing), Arrange by feed, pipe schedule, sizing check, index circuit and
   pump head, saved scenarios, SI / IP, 2D export and print.
2. Step 5 - wiring (see the project instructions, "Scope").

## Notes for the next steps
- New branch types and their properties go into `maps.types` with a new SQL file; `maps.clean_props` checks them (kinds
  number, enum, text, bool, list) and the forms read them from `maps_types()`. The outline reader (`assets/mp-io.js`,
  `KEYS`) gets the old special-note keys (Flow, Leaving, Source, Pump head, Switch, Icon ...) for those types; until then
  they stay special notes.
- `maps_create` accepts `knowledge` and `flowchart`; steps 4 and 5 replace it to allow `piping` and `wiring`.
- `maps_line_add` accepts `link`, `web`, `tile`, `flow`; steps 4 and 5 add `pipe`, `wire`, `control`.
- Drag to place: `assets/mp-chart.js` (`down` / `move` / `up`, 10 grid, edge scroll, clash-guarded save of `place`);
  arrow routing that goes round steps: `route()` in `assets/mp-fc.js`. Piping's 2D view should share these.
- The engines, symbols and their checks (Thinkneering `mp-water.js`, `mp-power.js`, `mp-flow.js`, `mp-schematic.js`,
  `mp-signs.js`, `scripts/mp-*-check.mjs`) come over in steps 4 and 5, reading typed values instead of special notes.

## Changes from the core this tile follows
- 2026-11-05 installed app: head block with `viewport-fit=cover` and `theme-color` (done in `index.html`).
- 2026-11-05 accounts can be renamed and deleted: keyed by user id, names from `core.display_names`, no foreign keys
  to accounts; tests insert `auth.sessions` before `core_session_start()` (done).
