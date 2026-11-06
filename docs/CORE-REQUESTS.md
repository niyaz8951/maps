# Requests to the core

What this tile needs from the admin project (`dame-hub`): one entry per request, newest first, with why and a workaround meanwhile. The admin project answers here or in `dame-hub/docs/STATUS.md`.

## Open
- 2026-11-06 - `db/core/tests.sql` fails on the live project at line 49: `insert into auth.users (email, raw_user_meta_data)`
  gives no `id`; Supabase's `auth.users.id` has no default (the local `supabase-stub.sql` has one), so the insert stops at
  the not-null check before the username check it means to test (owner's run, 2026-11-06). The same pattern is on lines
  50-52, 307 and 398. Why: the owner cannot run the core tests on live. Blocking: no (maps' own `tests.sql` gives every
  id). Suggestion: give `id` (`gen_random_uuid()`) and the columns Supabase requires, as `pg_temp.act_as` setups in the
  tiles do, and drop the default from the stub so the local run catches it.
## Done
- 2026-11-05 - Please update the copy `docs/tiles/maps-project-instructions.md`: the owner added **flowcharts** as a fourth
  kind. Done by the admin project 2026-11-05.
