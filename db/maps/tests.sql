-- Maps tile tests. Run on STAGING after db/maps/*.sql in order (while there is no staging project, the owner decides).
-- Self-contained: makes its own throw-away accounts (mt_*), switches the tile on inside the test, and rolls everything
-- back at the end, so nothing stays behind. Ends with "ALL MAPS TESTS PASSED".
begin;

-- the tile on, with its rights, for this transaction only
insert into core.tiles (id, name, tagline, icon, enabled, rights)
values ('maps', 'Maps', 'Knowledge, piping and wiring maps', 'map', true, array['edit', 'verify'])
on conflict (id) do update set enabled = true, rights = array['edit', 'verify'];

-- throw-away accounts
do $$
declare v_name text; v_id uuid;
begin
  foreach v_name in array array['mt_admin', 'mt_edit', 'mt_edit2', 'mt_verify', 'mt_read', 'mt_none', 'mt_pending', 'mt_disabled'] loop
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_name || '@users.dame-hub.local', '', now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('username', v_name, 'display_name', initcap(replace(v_name, '_', ' '))),
      now(), now(), '', '', '', '', '', '', '', '');
  end loop;
  update core.profiles set status = 'active' where username like 'mt\_%' and username <> 'mt_pending';
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', true, '{}' from core.profiles where username = 'mt_admin';
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', false, array['edit'] from core.profiles where username in ('mt_edit', 'mt_edit2', 'mt_disabled');
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', false, array['verify'] from core.profiles where username = 'mt_verify';
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', false, '{}' from core.profiles where username = 'mt_read';
end $$;

create temp table t_ids as select username k, id from core.profiles where username like 'mt\_%';
create temp table t_v (k text primary key, v text);
grant select on t_ids to public;
grant select, insert, update on t_v to public;

create or replace function pg_temp.act_as(p_key text) returns void language plpgsql as $$
declare v_id uuid; v_sid uuid := gen_random_uuid();
begin
  execute 'reset role';
  if p_key is null then perform set_config('request.jwt.claims', '', true); perform set_config('role', 'anon', true); return; end if;
  select id into v_id from t_ids where k = p_key;
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, v_id, now(), now()); -- as Supabase Auth at sign-in
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'session_id', v_sid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.core_session_start();
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error % from: %', p_code, p_sql;
exception when others then
  if sqlerrm = p_code or (p_code = 'PERMISSION' and sqlstate = '42501') then return; end if;
  if sqlerrm like 'expected error%' then raise; end if;
  raise exception 'expected % but got % (%) from: %', p_code, sqlerrm, sqlstate, p_sql;
end $$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $$
  insert into t_v values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function pg_temp.got(p_k text) returns text language sql as $$ select v from t_v where k = p_k $$;
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'FAILED: %', p_what; end if; end $$;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text), pg_temp.put(text, text), pg_temp.got(text),
  pg_temp.check(boolean, text) to public;

do $$
declare v jsonb; n integer; v_a uuid; v_b uuid; v_c uuid; v_root uuid; v_x uuid; v_y uuid; v_z uuid; v_line uuid; v_ver integer;
begin
  -- ---------------------------------------------------------------- refused before anything: signed out, pending, disabled, no tile
  perform pg_temp.act_as(null);
  perform pg_temp.expect_error('select public.maps_list()', 'PERMISSION');
  perform pg_temp.expect_error('select public.maps_create(''x'', ''knowledge'', ''private'', null)', 'PERMISSION');
  reset role;

  perform pg_temp.act_as('mt_pending');
  perform pg_temp.expect_error('select public.maps_list()', 'NOT_APPROVED');
  perform pg_temp.expect_error('select public.maps_get(gen_random_uuid())', 'NOT_APPROVED');
  reset role;

  perform pg_temp.act_as('mt_disabled');         -- signed in while active, then disabled: refused on the next call
  reset role;
  update core.profiles set status = 'disabled' where username = 'mt_disabled';
  perform set_config('role', 'authenticated', true);
  perform pg_temp.expect_error('select public.maps_list()', 'NOT_APPROVED');
  perform pg_temp.expect_error('select public.maps_create(''x'', ''knowledge'', ''private'', null)', 'NOT_APPROVED');
  reset role;

  perform pg_temp.act_as('mt_none');
  perform pg_temp.expect_error('select public.maps_list()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.maps_types()', 'NO_ACCESS');
  perform pg_temp.expect_error('select public.maps_search(''pump'')', 'NO_ACCESS');
  reset role;

  -- ---------------------------------------------------------------- an editor makes three maps
  perform pg_temp.act_as('mt_edit');
  v := public.maps_list(); perform pg_temp.check((v -> 'me' ->> 'editor')::boolean and not (v -> 'me' ->> 'verifier')::boolean, 'editor flags');
  v := public.maps_create(' Chiller ', 'knowledge', 'private',
    '[{"depth":0,"title":"Components"},{"depth":1,"title":"Compressor","notes":"Raises the pressure.","special":["Check the starting current"]},
      {"depth":1,"title":"Evaporator"},{"depth":0,"title":"Standards","props":{"layout":"columns"}},{"depth":5,"title":"AHRI 550/590"}]');
  v_a := (v ->> 'id')::uuid; perform pg_temp.put('a', v_a::text);
  v := public.maps_get(v_a);
  perform pg_temp.check(v -> 'map' ->> 'name' = 'Chiller' and v -> 'map' ->> 'right' = 'manage', 'own map: manage');
  perform pg_temp.check(jsonb_array_length(v -> 'branches') = 6, 'centre + 5 starter branches');
  select (b ->> 'id')::uuid into v_root from jsonb_array_elements(v -> 'branches') b where b ->> 'parent' is null;
  perform pg_temp.check((select count(*) from jsonb_array_elements(v -> 'branches') b where b ->> 'status' = 'to_verify') = 5, 'starter comes in to verify');
  perform pg_temp.check((select b ->> 'parent' from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'AHRI 550/590')
    = (select b ->> 'id' from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'Standards'), 'depth jump clamped to one level');
  perform pg_temp.expect_error('select public.maps_create(''chiller'', ''knowledge'', ''private'', null)', 'INVALID:name_taken');
  perform pg_temp.expect_error('select public.maps_create(''Pumps'', ''piping'', ''private'', null)', 'INVALID:kind');
  perform pg_temp.expect_error('select public.maps_create(''Pumps'', ''knowledge'', ''everyone'', null)', 'INVALID:share');
  perform pg_temp.expect_error('select public.maps_create(''   '', ''knowledge'', ''private'', null)', 'INVALID:title');
  perform pg_temp.expect_error('select public.maps_create(''X'', ''knowledge'', ''private'', ''[{"title":"A","props":{"flow":3}}]'')', 'INVALID:props');
  v_b := (public.maps_create('Team AHU', 'knowledge', 'team_edit', null) ->> 'id')::uuid; perform pg_temp.put('b', v_b::text);
  v_c := (public.maps_create('Team FCU', 'knowledge', 'team_read', null) ->> 'id')::uuid; perform pg_temp.put('c', v_c::text);
  perform pg_temp.check(jsonb_array_length(public.maps_list() -> 'maps') = 3, 'list: three maps');

  -- branches: add, save with the version read, clash, checks
  v := public.maps_branch_add(v_root, ' Condenser '); v_x := (v ->> 'id')::uuid; perform pg_temp.put('x', v_x::text);
  perform pg_temp.check(v ->> 'title' = 'Condenser' and v ->> 'status' = 'to_verify' and (v ->> 'version')::integer = 1, 'add: to verify, version 1');
  v := public.maps_branch_save(v_x, 1, '{"notes":"Rejects heat.","special":["Air-cooled","  ",""],"props":{"layout":"columns"},"place":{"x":120,"y":80}}');
  perform pg_temp.check((v ->> 'version')::integer = 2 and v -> 'special' = '["Air-cooled"]' and v -> 'props' ->> 'layout' = 'columns'
    and v -> 'place' = '{"x": 120, "y": 80}'::jsonb, 'save: cleaned values, version 2');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 1, ''{"notes":"old copy"}'')', v_x), 'INVALID:version');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"title":"  "}'')', v_x), 'INVALID:title');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, %L)', v_x, jsonb_build_object('notes', repeat('x', 8001))), 'INVALID:notes');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, %L)', v_x, jsonb_build_object('special', array[repeat('x', 201)])), 'INVALID:special');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"props":{"layout":"spiral"}}'')', v_x), 'INVALID:props');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"props":{"flow":12}}'')', v_x), 'INVALID:props');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"type":"pump"}'')', v_x), 'INVALID:type');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"place":{"x":1}}'')', v_x), 'INVALID:place');
  v := public.maps_branch_save(v_x, 2, '{"notes":"Rejects heat to air."}');                 -- typing on: one history entry
  perform pg_temp.check((select count(*) from jsonb_array_elements(public.maps_history(v_a, v_x)) h where h ->> 'action' = 'branch_edit') = 1, 'edits coalesce in history');
  -- the centre is the map's name
  v := public.maps_branch_save(v_root, 1, '{"title":"Chiller unit"}');
  perform pg_temp.check(public.maps_get(v_a) -> 'map' ->> 'name' = 'Chiller unit', 'renaming the centre renames the map');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"title":"Team AHU"}'')', v_root), 'INVALID:name_taken');

  -- lines: a link inside the map, a web link, refusals
  select (b ->> 'id')::uuid into v_y from jsonb_array_elements(public.maps_get(v_a) -> 'branches') b where b ->> 'title' = 'Compressor';
  perform pg_temp.put('y', v_y::text);
  v := public.maps_line_add(v_x, 'link', 'requires', v_y, null, ''); v_line := (v ->> 'id')::uuid; perform pg_temp.put('line', v_line::text);
  v := public.maps_line_add(v_x, 'web', null, null, 'https://example.com/condenser', 'Datasheet');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''link'', ''requires'', %L, null, null)', v_x, v_y), 'INVALID:duplicate');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''link'', ''loves'', %L, null, null)', v_x, v_y), 'INVALID:rel');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''link'', ''see'', %L, null, null)', v_x, v_x), 'INVALID:to');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''web'', null, null, ''http://example.com/x'', null)', v_x), 'INVALID:target');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''web'', null, null, ''javascript:alert(1)'', null)', v_x), 'INVALID:target');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''pipe'', ''p-supply'', %L, null, null)', v_x, v_y), 'INVALID:kind');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', ''next'', %L, null, ''Yes'')', v_x, v_y), 'INVALID:kind');   -- arrows: flowcharts only
  perform pg_temp.expect_error('select public.maps_create(''Pumps'', ''piping'', ''private'', null)', 'INVALID:kind');                  -- piping: step 4
  -- links to another tile (003): '<tile-id>' or '<tile-id>/<path>', never a full address
  v := public.maps_line_add(v_x, 'tile', null, null, 'projects', 'Projects');
  v := public.maps_line_add(v_x, 'tile', null, null, '/hvac-notes/note.html?id=12#top', null);
  perform pg_temp.check((select l ->> 'target' from jsonb_array_elements(public.maps_get(v_a) -> 'lines') l where l ->> 'id' = v ->> 'id') = 'hvac-notes/note.html?id=12#top', 'tile link kept without the leading slash');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''tile'', null, null, ''https://example.com/x'', null)', v_x), 'INVALID:target');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''tile'', null, null, ''projects/../dame-hub/admin.html'', null)', v_x), 'INVALID:target');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''tile'', null, null, ''Projects'', null)', v_x), 'INVALID:target');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''tile'', null, null, ''projects//evil'', null)', v_x), 'INVALID:target');
  perform public.maps_line_delete((l ->> 'id')::uuid) from jsonb_array_elements(public.maps_get(v_a) -> 'lines') l where l ->> 'kind' = 'tile';
  v := public.maps_line_save(v_line, 1, 'part', 'Part of');
  perform pg_temp.expect_error(format('select public.maps_line_save(%L, 1, ''see'', null)', v_line), 'INVALID:version');
  perform pg_temp.check((select count(*) from jsonb_array_elements(public.maps_get(v_a) -> 'lines')) = 2, 'two lines on the map');

  -- import: depth, limits
  v := public.maps_import(v_root, '[{"depth":0,"title":"Controls"},{"depth":1,"title":"Controller","notes":"PLC"},{"depth":1,"title":"Sensors","place":{"x":10,"y":20,"w":60,"h":40}}]');
  perform pg_temp.check((v ->> 'added')::integer = 3, 'import adds 3');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[]'')', v_root), 'INVALID:items');
  perform pg_temp.expect_error(format('select public.maps_import(%L, %L)', v_root,
    (select jsonb_agg(jsonb_build_object('depth', 0, 'title', 'B' || i)) from generate_series(1, 501) i)), 'INVALID:items');

  -- move: up, into another parent, never inside itself
  select (b ->> 'id')::uuid into v_z from jsonb_array_elements(public.maps_get(v_a) -> 'branches') b where b ->> 'title' = 'Components';
  perform pg_temp.put('z', v_z::text);
  v := public.maps_branch_move(v_x, v_root, 0);
  perform pg_temp.check(v -> 'order' ->> 0 = v_x::text, 'moved first');
  v := public.maps_branch_move(v_x, v_z, null);
  perform pg_temp.check((select b ->> 'parent' from jsonb_array_elements(public.maps_get(v_a) -> 'branches') b where b ->> 'id' = v_x::text) = v_z::text, 'moved under Components');
  perform pg_temp.expect_error(format('select public.maps_branch_move(%L, %L, 0)', v_z, v_x), 'INVALID:parent');
  perform pg_temp.expect_error(format('select public.maps_branch_move(%L, %L, 0)', v_root, v_z), 'INVALID:branch');

  -- verify is for verifiers; "to verify" is for editors too
  perform pg_temp.expect_error(format('select public.maps_verify(%L, true, false)', v_y), 'NO_RIGHT');
  v := public.maps_verify(v_root, false, false);
  perform pg_temp.check((v ->> 'changed')::integer = 1, 'editor marks to verify');

  -- delete to the trash, restore
  v := public.maps_branch_delete(v_z);
  perform pg_temp.check((v ->> 'deleted')::integer = 4, 'Components with 3 under it to the trash');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(public.maps_get(v_a) -> 'branches') b where b ->> 'id' = v_x::text), 'trashed branch hidden');
  perform pg_temp.check((select count(*) from jsonb_array_elements(public.maps_get(v_a) -> 'lines')) = 0, 'lines of trashed branches hidden');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 3, ''{"notes":"x"}'')', v_x), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.maps_branch_delete(%L)', v_root), 'INVALID:branch');
  v := public.maps_trash(v_a);
  perform pg_temp.check(jsonb_array_length(v -> 'branches') = 1 and (v -> 'branches' -> 0 ->> 'with')::integer = 3, 'trash shows one entry with 3 under it');
  v := public.maps_branch_restore(v_z);
  perform pg_temp.check((v ->> 'restored')::integer = 4, 'restored 4');
  perform pg_temp.check((select count(*) from jsonb_array_elements(public.maps_get(v_a) -> 'lines')) = 2, 'lines back');

  -- search finds in names, special notes, notes
  v := public.maps_search('compress');
  perform pg_temp.check(v -> 0 ->> 'title' = 'Compressor' and v -> 0 ->> 'in' = 'name', 'search by name');
  v := public.maps_search('starting current');
  perform pg_temp.check(v -> 0 ->> 'in' = 'special note', 'search in special notes');
  v := public.maps_search('heat to air');
  perform pg_temp.check(v -> 0 ->> 'in' = 'notes', 'search in notes');
  perform pg_temp.check(jsonb_array_length(public.maps_search('%')) = 0 and jsonb_array_length(public.maps_search('x')) = 0, 'search: short or wildcard finds nothing');
  perform pg_temp.check(jsonb_array_length(public.maps_history(v_a)) > 5, 'history kept');

  -- a cross-map link from the private map to the team map
  select (b ->> 'id')::uuid into v_z from jsonb_array_elements(public.maps_get(v_b) -> 'branches') b where b ->> 'parent' is null;
  perform pg_temp.put('b_root', v_z::text);
  perform public.maps_line_add(v_y, 'link', 'see', v_z, null, null);
  perform pg_temp.check((select count(*) from jsonb_array_elements(public.maps_get(v_b) -> 'lines')) = 1, 'owner sees the link from his private map');
  v := public.maps_branch_add(v_z, 'Fan section'); perform pg_temp.put('b_fan', v ->> 'id');
  reset role;

  -- ---------------------------------------------------------------- another editor: private map invisible, team maps per share
  perform pg_temp.act_as('mt_edit2');
  v_a := pg_temp.got('a')::uuid; v_b := pg_temp.got('b')::uuid; v_c := pg_temp.got('c')::uuid;
  perform pg_temp.check(jsonb_array_length(public.maps_list() -> 'maps') = 2, 'other editor: two team maps');
  perform pg_temp.expect_error(format('select public.maps_get(%L)', v_a), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 3, ''{"notes":"x"}'')', pg_temp.got('x')), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.maps_branch_add(%L, ''x'')', pg_temp.got('y')), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.maps_history(%L)', v_a), 'NOT_FOUND');
  perform pg_temp.check(public.maps_trash(v_a) = '{"maps": [], "branches": []}'::jsonb, 'trash of a private map of another: empty');
  perform pg_temp.check(jsonb_array_length(public.maps_search('compress')) = 0, 'search skips a private map');
  perform pg_temp.check((select count(*) from jsonb_array_elements(public.maps_get(v_b) -> 'lines')) = 0, 'a link from a private map is not shown');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''link'', ''see'', %L, null, null)', pg_temp.got('b_fan'), pg_temp.got('y')), 'NOT_FOUND');
  v := public.maps_get(v_b); perform pg_temp.check(v -> 'map' ->> 'right' = 'edit', 'team_edit: edit');
  v := public.maps_branch_add(pg_temp.got('b_root')::uuid, 'Filter section');
  perform pg_temp.expect_error(format('select public.maps_map_save(%L, 1, ''Renamed'', null)', v_b), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.maps_map_delete(%L)', v_b), 'NO_RIGHT');
  v := public.maps_get(v_c); perform pg_temp.check(v -> 'map' ->> 'right' = 'read', 'team_read: read');
  select (b ->> 'id')::uuid into v_z from jsonb_array_elements(v -> 'branches') b where b ->> 'parent' is null;
  perform pg_temp.put('c_root', v_z::text);
  perform pg_temp.expect_error(format('select public.maps_branch_add(%L, ''x'')', v_z), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"title":"x"}]'')', v_z), 'NO_RIGHT');
  -- the clash: two people read version 1 of the fan section; this one saves first
  v := public.maps_branch_save(pg_temp.got('b_fan')::uuid, 1, '{"notes":"EC plug fan."}');
  reset role;

  perform pg_temp.act_as('mt_edit');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 1, ''{"notes":"Belt drive."}'')', pg_temp.got('b_fan')), 'INVALID:version');
  reset role;

  -- ---------------------------------------------------------------- read only: no right
  perform pg_temp.act_as('mt_read');
  v_a := pg_temp.got('a')::uuid; v_c := pg_temp.got('c')::uuid;
  perform pg_temp.check(jsonb_array_length(public.maps_list() -> 'maps') = 2, 'reader: two team maps');
  perform pg_temp.check(public.maps_get(pg_temp.got('b')::uuid) -> 'map' ->> 'right' = 'read', 'team_edit is read without the right');
  perform pg_temp.expect_error('select public.maps_create(''Mine'', ''knowledge'', ''private'', null)', 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.maps_branch_add(%L, ''x'')', pg_temp.got('b_root')), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"title":"x"}]'')', pg_temp.got('b_root')), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.maps_verify(%L, true, false)', pg_temp.got('c_root')), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.maps_get(%L)', v_a), 'NOT_FOUND');
  reset role;

  -- ---------------------------------------------------------------- verifier: verify, "changed since verified"
  perform pg_temp.act_as('mt_verify');
  v_b := pg_temp.got('b')::uuid;
  v := public.maps_verify(pg_temp.got('b_fan')::uuid, true, false);
  perform pg_temp.check((v ->> 'changed')::integer = 1, 'verified');
  perform pg_temp.check((select b ->> 'status' from jsonb_array_elements(public.maps_get(v_b) -> 'branches') b where b ->> 'id' = pg_temp.got('b_fan')) = 'verified', 'status verified');
  perform pg_temp.expect_error(format('select public.maps_verify(%L, true, false)', pg_temp.got('y')), 'NOT_FOUND');   -- private map of another user
  perform pg_temp.expect_error(format('select public.maps_branch_add(%L, ''x'')', pg_temp.got('b_root')), 'NO_RIGHT');
  reset role;

  perform pg_temp.act_as('mt_edit2');
  select (b ->> 'version')::integer into v_ver from jsonb_array_elements(public.maps_get(pg_temp.got('b')::uuid) -> 'branches') b where b ->> 'id' = pg_temp.got('b_fan');
  v := public.maps_branch_save(pg_temp.got('b_fan')::uuid, v_ver, '{"notes":"EC plug fan, IE5 motor."}');
  perform pg_temp.check(v ->> 'status' = 'changed', 'changed since verified');
  v := public.maps_get(pg_temp.got('b')::uuid);
  perform pg_temp.check(v -> 'verified_facts' -> pg_temp.got('b_fan') ->> 'notes' = 'EC plug fan.', 'the verified fact is there to compare');
  reset role;

  perform pg_temp.act_as('mt_verify');
  perform pg_temp.expect_error(format('select public.maps_verify(%L, true, false)', pg_temp.got('b')), 'NOT_FOUND');   -- a map id, not a branch
  reset role;
end $$;

-- ---------------------------------------------------------------- 003: flowcharts through the functions
do $$
declare v jsonb; v_f uuid; v_root uuid; v_s uuid; v_d uuid; v_p uuid; v_e uuid; v_new uuid; v_l uuid; v_priv uuid;
begin
  perform pg_temp.act_as('mt_edit');
  v := public.maps_create('Approval', 'flowchart', 'team_edit',
    '[{"key":"s","type":"start","title":"Request received","props":{"lane":"Sales"},"next":[{"to":"d"}]},
      {"key":"d","type":"decision","title":"Standard product?","props":{"lane":"Sales"},"next":[{"to":"p","label":"Yes"},{"to":"s","label":" No "}]},
      {"key":"p","title":"Prepare offer","props":{"lane":"Application"},"next":[{"to":"e"}]},
      {"key":"e","type":"end","title":"Offer sent","place":{"x":40,"y":400}}]');
  v_f := (v ->> 'id')::uuid; perform pg_temp.put('f', v_f::text);
  v := public.maps_get(v_f);
  perform pg_temp.check(v -> 'map' ->> 'kind' = 'flowchart', 'flowchart made');
  perform pg_temp.check((select b -> 'props' -> 'lanes' from jsonb_array_elements(v -> 'branches') b where b ->> 'parent' is null) = '["Sales", "Application"]'::jsonb, 'lanes kept in the order first used');
  perform pg_temp.check(jsonb_array_length(v -> 'branches') = 5, 'centre and four steps');
  perform pg_temp.check((select count(*) from jsonb_array_elements(v -> 'lines') l where l ->> 'kind' = 'flow') = 4, 'four arrows, the loop back included');
  select (b ->> 'id')::uuid into v_root from jsonb_array_elements(v -> 'branches') b where b ->> 'parent' is null;
  select (b ->> 'id')::uuid into v_s from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'Request received';
  select (b ->> 'id')::uuid into v_d from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'Standard product?';
  select (b ->> 'id')::uuid into v_p from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'Prepare offer';
  select (b ->> 'id')::uuid into v_e from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'Offer sent';
  perform pg_temp.check((select b ->> 'type' from jsonb_array_elements(v -> 'branches') b where (b ->> 'id')::uuid = v_p) = 'process', 'no type given: Process');
  perform pg_temp.check((select b -> 'place' ->> 'y' from jsonb_array_elements(v -> 'branches') b where (b ->> 'id')::uuid = v_e) = '400.0', 'place kept');
  perform pg_temp.check((select l ->> 'label' from jsonb_array_elements(v -> 'lines') l where (l ->> 'from')::uuid = v_d and (l ->> 'to')::uuid = v_s) = 'No', 'label trimmed');
  perform pg_temp.check((select b ->> 'status' from jsonb_array_elements(v -> 'branches') b where (b ->> 'id')::uuid = v_d) = 'to_verify', 'imported steps to verify');
  -- steps: always under the centre, a new one is a Process
  v := public.maps_branch_add(v_root, 'Check stock'); v_new := (v ->> 'id')::uuid;
  perform pg_temp.check(v ->> 'type' = 'process', 'new step is a Process');
  perform pg_temp.expect_error(format('select public.maps_branch_add(%L, ''Under a step'')', v_d), 'INVALID:parent');
  perform pg_temp.expect_error(format('select public.maps_branch_move(%L, %L, null)', v_new, v_d), 'INVALID:parent');
  v := public.maps_branch_save(v_new, 1, '{"type":"decision","props":{"lane":"Application"}}');
  perform pg_temp.check(v ->> 'type' = 'decision' and v -> 'props' ->> 'lane' = 'Application', 'shape and lane saved');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"type":"pump"}'')', v_new), 'INVALID:type');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"props":{"layout":"columns"}}'')', v_new), 'INVALID:props');
  -- drag to place: the place is saved with the version read; an older version is refused
  v := public.maps_branch_save(v_new, 2, '{"place":{"x":220.04,"y":-60}}');
  perform pg_temp.check(v -> 'place' ->> 'x' = '220.0' and v ->> 'status' = 'to_verify', 'place saved');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"place":{"x":1,"y":1}}'')', v_new), 'INVALID:version');
  v := public.maps_branch_save(v_new, 3, '{"place":null}');
  perform pg_temp.check(v -> 'place' = 'null'::jsonb, 'back to auto layout');
  -- lanes in order on the centre
  v := public.maps_branch_save(v_root, 1, '{"props":{"lanes":[" Application ","Sales","sales",""]}}');
  perform pg_temp.check(v -> 'props' -> 'lanes' = '["Application", "Sales"]'::jsonb, 'lanes reordered, trimmed, no repeats');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, %L)', v_root,
    jsonb_build_object('props', jsonb_build_object('lanes', (select jsonb_agg('Lane ' || g) from generate_series(1, 13) g)))), 'INVALID:props');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, %L)', v_root,
    jsonb_build_object('props', jsonb_build_object('lanes', jsonb_build_array(repeat('x', 41))))), 'INVALID:props');
  -- arrows
  v := public.maps_line_add(v_new, 'flow', null, v_p, null, 'Yes'); v_l := (v ->> 'id')::uuid;
  perform pg_temp.check((select l ->> 'rel' from jsonb_array_elements(public.maps_get(v_f) -> 'lines') l where (l ->> 'id')::uuid = v_l) = 'next', 'arrow: rel next');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, ''Again'')', v_new, v_p), 'INVALID:duplicate');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, null)', v_new, v_root), 'INVALID:to');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, null)', v_root, v_new), 'INVALID:to');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, null)', v_new, v_new), 'INVALID:to');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, null)', v_new, pg_temp.got('x')), 'INVALID:to');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, %L)', v_new, v_e, repeat('y', 41)), 'INVALID:label');
  v := public.maps_line_save(v_l, 1, null, 'No');
  perform pg_temp.check((select l ->> 'label' from jsonb_array_elements(public.maps_get(v_f) -> 'lines') l where (l ->> 'id')::uuid = v_l) = 'No', 'answer changed');
  perform pg_temp.expect_error(format('select public.maps_line_save(%L, 2, ''see'', null)', v_l), 'INVALID:rel');
  perform pg_temp.expect_error(format('select public.maps_line_save(%L, 1, null, ''Yes'')', v_l), 'INVALID:version');
  -- import into a flowchart: under the centre, flat, arrows inside the items only
  v := public.maps_import(v_root, '[{"key":"a","title":"Approve","next":[{"to":"b","label":"OK"}]},{"key":"b","type":"end","title":"Done"}]');
  perform pg_temp.check((v ->> 'added')::integer = 2 and (v ->> 'arrows')::integer = 1, 'import with an arrow');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"title":"x"}]'')', v_d), 'INVALID:parent');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"title":"x","depth":1}]'')', v_root), 'INVALID:items');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"key":"a","title":"x","next":[{"to":"zz"}]}]'')', v_root), 'INVALID:items');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"key":"a","title":"x","next":[{"to":"a"}]}]'')', v_root), 'INVALID:items');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"key":"a","title":"x"},{"key":"a","title":"y"}]'')', v_root), 'INVALID:items');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"title":"x","type":"decision"}]'')', pg_temp.got('x')), 'INVALID:type');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"key":"a","title":"x","next":[{"to":"b"}]},{"key":"b","title":"y"}]'')', pg_temp.got('x')), 'INVALID:items');
  -- a deleted step takes its arrows off the chart
  perform public.maps_branch_delete(v_p);
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(public.maps_get(v_f) -> 'lines') l where (l ->> 'to')::uuid = v_p or (l ->> 'from')::uuid = v_p), 'arrows of a deleted step hidden');
  perform public.maps_branch_restore(v_p);
  perform pg_temp.check((select count(*) from jsonb_array_elements(public.maps_get(v_f) -> 'lines') l where (l ->> 'to')::uuid = v_p or (l ->> 'from')::uuid = v_p) = 3, 'arrows back with the step');
  v_priv := (public.maps_create('My flow', 'flowchart', 'private', null) ->> 'id')::uuid; perform pg_temp.put('fpriv', v_priv::text);
  reset role;

  -- another editor on a team-edit flowchart: may add arrows; a reader may not; a private one is not there
  perform pg_temp.act_as('mt_edit2');
  v := public.maps_line_add(v_e, 'flow', null, v_s, null, 'Next request');
  perform pg_temp.expect_error(format('select public.maps_get(%L)', pg_temp.got('fpriv')), 'NOT_FOUND');
  reset role;
  perform pg_temp.act_as('mt_read');
  perform pg_temp.check(public.maps_get(v_f) -> 'map' ->> 'right' = 'read', 'reader reads the flowchart');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, null)', v_s, v_e), 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 1, ''{"place":{"x":1,"y":1}}'')', v_s), 'NO_RIGHT');
  perform pg_temp.expect_error('select public.maps_create(''Mine'', ''flowchart'', ''private'', null)', 'NO_RIGHT');
  reset role;
  perform pg_temp.act_as('mt_verify');
  v := public.maps_verify(v_d, true, false);
  perform pg_temp.check((select b ->> 'status' from jsonb_array_elements(public.maps_get(v_f) -> 'branches') b where (b ->> 'id')::uuid = v_d) = 'verified', 'step verified');
  reset role;
  perform pg_temp.act_as('mt_edit');
  perform public.maps_line_save((select (l ->> 'id')::uuid from jsonb_array_elements(public.maps_get(v_f) -> 'lines') l where (l ->> 'from')::uuid = v_d and (l ->> 'to')::uuid = v_s), 1, null, 'Not standard');
  perform pg_temp.check((select b ->> 'status' from jsonb_array_elements(public.maps_get(v_f) -> 'branches') b where (b ->> 'id')::uuid = v_d) = 'changed', 'a changed answer shows as changed since verified');
  reset role;
  delete from maps.maps where id in (v_f, pg_temp.got('fpriv')::uuid);   -- out of the way of the trash counts below
end $$;

-- ---------------------------------------------------------------- 004: the review list and "send back"
do $$
declare v jsonb; v_n uuid; v_fan uuid := pg_temp.got('b_fan')::uuid;
begin
  perform pg_temp.act_as('mt_edit');
  perform pg_temp.expect_error('select public.maps_review()', 'NO_RIGHT');
  perform pg_temp.expect_error(format('select public.maps_send_back(%L, ''why'')', v_fan), 'NO_RIGHT');
  v_n := (public.maps_branch_add(pg_temp.got('b_root')::uuid, 'Damper section') ->> 'id')::uuid;   -- an editor's new branch: to verify
  reset role;
  perform pg_temp.act_as('mt_verify');
  perform public.maps_verify(v_fan, true, false);
  v := public.maps_review();
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(v -> 'items') i where (i ->> 'branch_id')::uuid = v_n and i ->> 'status' = 'to_verify'
    and i ->> 'map' = 'Team AHU' and i ->> 'parent' = 'Team AHU' and i ->> 'updated_by' = 'Mt Edit'), 'review list: the new branch, its map and who changed it');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(v -> 'items') i where (i ->> 'map_id')::uuid = pg_temp.got('a')::uuid), 'review list: never a private map of another user');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(v -> 'items') i where (i ->> 'branch_id')::uuid = v_fan), 'review list: a verified branch is not in it');
  v := public.maps_send_back(v_fan, '  Which fan curve? Add the reference.  ');
  v := public.maps_get(pg_temp.got('b')::uuid);
  perform pg_temp.check((select b ->> 'status' from jsonb_array_elements(v -> 'branches') b where (b ->> 'id')::uuid = v_fan) = 'to_verify', 'sent back: to verify again');
  perform pg_temp.check((select b -> 'review' ->> 'note' from jsonb_array_elements(v -> 'branches') b where (b ->> 'id')::uuid = v_fan) = 'Which fan curve? Add the reference.', 'sent back: the comment, trimmed');
  perform pg_temp.check((select b -> 'review' ->> 'by' from jsonb_array_elements(v -> 'branches') b where (b ->> 'id')::uuid = v_fan) = 'Mt Verify', 'sent back: by whom');
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(public.maps_review() -> 'items') i where (i ->> 'branch_id')::uuid = v_fan and i -> 'review' ->> 'note' like 'Which fan%'), 'sent back: in the review list with its comment');
  perform pg_temp.expect_error(format('select public.maps_send_back(%L, ''  '')', v_fan), 'INVALID:comment');
  perform pg_temp.expect_error(format('select public.maps_send_back(%L, %L)', v_fan, repeat('x', 501)), 'INVALID:comment');
  perform pg_temp.expect_error(format('select public.maps_send_back(%L, ''why'')', pg_temp.got('b_root')), 'INVALID:branch');
  perform pg_temp.expect_error(format('select public.maps_send_back(%L, ''why'')', pg_temp.got('x')), 'NOT_FOUND');
  reset role;
  -- the editor answers: the comment shows it was answered
  perform pg_temp.act_as('mt_edit');
  v := public.maps_branch_save(v_fan, (select (b ->> 'version')::integer from jsonb_array_elements(public.maps_get(pg_temp.got('b')::uuid) -> 'branches') b where (b ->> 'id')::uuid = v_fan),
    '{"notes":"Fan curve: see the selection sheet."}');
  perform pg_temp.check((v -> 'review' ->> 'answered')::boolean, 'changed after it was sent back: answered');
  reset role;
  -- the verifier verifies: the comment goes
  perform pg_temp.act_as('mt_verify');
  v := public.maps_verify(v_fan, true, false);
  perform pg_temp.check((select b -> 'review' from jsonb_array_elements(public.maps_get(pg_temp.got('b')::uuid) -> 'branches') b where (b ->> 'id')::uuid = v_fan) = 'null'::jsonb, 'verified: the comment is cleared');
  perform public.maps_verify(v_n, true, false);
  reset role;
  perform pg_temp.act_as('mt_none');
  perform pg_temp.expect_error('select public.maps_review()', 'NO_ACCESS');
  reset role;
end $$;

-- ---------------------------------------------------------------- 005: process flows (replies, Note, group, notes in the box, style)
do $$
declare v jsonb; v_f uuid; v_root uuid; v_a uuid; v_b uuid; v_n uuid; v_l uuid;
begin
  perform pg_temp.act_as('mt_edit');
  v := public.maps_create('Escalation', 'flowchart', 'private',
    '[{"key":"a","title":"First line","props":{"group":"Office","show_notes":true},"notes":"- Answer\n- Log","next":[{"to":"b","label":"Not resolved"}]},
      {"key":"b","title":"Specialists","props":{"group":"Office"},"next":[{"to":"a","label":"Answer","reply":true}]},
      {"key":"n","type":"note","title":"Not handled here","notes":"Orders"}]');
  v_f := (v ->> 'id')::uuid;
  v := public.maps_get(v_f);
  select (b ->> 'id')::uuid into v_root from jsonb_array_elements(v -> 'branches') b where b ->> 'parent' is null;
  select (b ->> 'id')::uuid into v_a from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'First line';
  select (b ->> 'id')::uuid into v_b from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'Specialists';
  select (b ->> 'id')::uuid into v_n from jsonb_array_elements(v -> 'branches') b where b ->> 'title' = 'Not handled here';
  perform pg_temp.check((select l ->> 'rel' from jsonb_array_elements(v -> 'lines') l where (l ->> 'from')::uuid = v_b) = 'reply', 'import: a reply arrow');
  perform pg_temp.check((select b -> 'props' from jsonb_array_elements(v -> 'branches') b where (b ->> 'id')::uuid = v_a) = '{"group": "Office", "show_notes": true}'::jsonb, 'group and notes-in-the-box kept');
  perform pg_temp.check((select b ->> 'type' from jsonb_array_elements(v -> 'branches') b where (b ->> 'id')::uuid = v_n) = 'note', 'a Note');
  -- the kind of chart, on the centre
  v := public.maps_branch_save(v_root, 1, '{"props":{"style":"process"}}');
  perform pg_temp.check(v -> 'props' ->> 'style' = 'process', 'a process flow');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 2, ''{"props":{"style":"mindmap"}}'')', v_root), 'INVALID:props');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 1, ''{"props":{"show_notes":"yes"}}'')', v_b), 'INVALID:props');
  perform pg_temp.expect_error(format('select public.maps_branch_save(%L, 1, ''{"props":{"group":"x"}}'')', v_n), 'INVALID:props');
  -- arrows: next or reply, never to or from a Note
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', ''reply'', %L, null, null)', v_a, v_b), 'INVALID:duplicate');   -- one arrow per pair
  v := public.maps_branch_add(v_root, 'Third line');
  v := public.maps_line_add((v ->> 'id')::uuid, 'flow', 'reply', v_a, null, 'Ask again'); v_l := (v ->> 'id')::uuid;
  perform pg_temp.check((select l ->> 'rel' from jsonb_array_elements(public.maps_get(v_f) -> 'lines') l where (l ->> 'id')::uuid = v_l) = 'reply', 'reply arrow added');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', ''answer'', %L, null, null)', v_b, v_a), 'INVALID:rel');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, null)', v_a, v_n), 'INVALID:to');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', null, %L, null, null)', v_n, v_a), 'INVALID:to');
  v := public.maps_line_save(v_l, 1, 'next', null);
  perform pg_temp.check((select l ->> 'rel' from jsonb_array_elements(public.maps_get(v_f) -> 'lines') l where (l ->> 'id')::uuid = v_l) = 'next', 'a reply made an arrow');
  perform pg_temp.expect_error(format('select public.maps_line_save(%L, 2, ''see'', null)', v_l), 'INVALID:rel');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"key":"x","title":"x","next":[{"to":"y"}]},{"key":"y","type":"note","title":"y"}]'')', v_root), 'INVALID:items');
  perform pg_temp.expect_error(format('select public.maps_import(%L, ''[{"key":"x","title":"x","next":[{"to":"y","reply":"yes"}]},{"key":"y","title":"y"}]'')', v_root), 'INVALID:items');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''link'', ''reply'', %L, null, null)', v_a, v_b), 'INVALID:rel');
  reset role;
  perform pg_temp.act_as('mt_edit2');
  perform pg_temp.expect_error(format('select public.maps_line_add(%L, ''flow'', ''reply'', %L, null, null)', v_b, v_a), 'NOT_FOUND');
  reset role;
  delete from maps.maps where id = v_f;
end $$;

do $$
declare v jsonb; v_b uuid; v_a uuid; v_new uuid;
begin
  perform pg_temp.act_as('mt_verify');
  v := public.maps_verify(pg_temp.got('b_fan')::uuid, true, true);
  perform pg_temp.check((select b ->> 'status' from jsonb_array_elements(public.maps_get(pg_temp.got('b')::uuid) -> 'branches') b where b ->> 'id' = pg_temp.got('b_fan')) = 'verified', 'verified again');
  reset role;

  -- ---------------------------------------------------------------- tile admin: shared maps yes, private no
  perform pg_temp.act_as('mt_admin');
  v_a := pg_temp.got('a')::uuid; v_b := pg_temp.got('b')::uuid;
  perform pg_temp.expect_error(format('select public.maps_get(%L)', v_a), 'NOT_FOUND');
  perform pg_temp.expect_error(format('select public.maps_map_delete(%L)', v_a), 'NOT_FOUND');
  perform pg_temp.check(public.maps_get(v_b) -> 'map' ->> 'right' = 'manage', 'admin manages a shared map');
  v := public.maps_map_save(v_b, 1, 'Team AHU map', 'team_read');
  perform pg_temp.check((v ->> 'version')::integer = 2, 'settings saved');
  perform pg_temp.expect_error(format('select public.maps_map_save(%L, 1, ''Again'', null)', v_b), 'INVALID:version');
  perform pg_temp.expect_error(format('select public.maps_map_save(%L, 2, null, ''private'')', v_b), 'NO_RIGHT');
  perform public.maps_map_delete(v_b);
  perform pg_temp.expect_error(format('select public.maps_get(%L)', v_b), 'NOT_FOUND');
  perform pg_temp.check(jsonb_array_length(public.maps_trash() -> 'maps') = 1, 'admin sees the shared map in the trash');
  v := public.maps_map_restore(v_b);
  perform pg_temp.check(public.maps_get(v_b) -> 'map' ->> 'name' = 'Team AHU map', 'restored');
  reset role;

  perform pg_temp.act_as('mt_edit2');
  perform pg_temp.expect_error(format('select public.maps_map_restore(%L)', v_b), 'NOT_FOUND');   -- not in the trash any more
  perform pg_temp.check(jsonb_array_length(public.maps_trash() -> 'maps') = 0, 'no trash for a non-manager');
  reset role;

  -- ---------------------------------------------------------------- owner: delete, same name meanwhile, restore as "(restored)"
  perform pg_temp.act_as('mt_edit');
  perform public.maps_map_delete(v_a);
  perform pg_temp.check(jsonb_array_length(public.maps_list() -> 'maps') = 2, 'deleted map leaves the list');
  v_new := (public.maps_create('Chiller unit', 'knowledge', 'private', null) ->> 'id')::uuid;
  v := public.maps_map_restore(v_a);
  perform pg_temp.check(v ->> 'name' = 'Chiller unit (restored)', 'restored under another name');
  reset role;
  perform pg_temp.act_as('mt_admin');
  perform pg_temp.expect_error(format('select public.maps_map_restore(%L)', v_a), 'NOT_FOUND');
  reset role;

  -- ---------------------------------------------------------------- trash older than 30 days goes when the tile is used
  update maps.maps set deleted_at = now() - interval '31 days' where id = v_new;
  update maps.branches set deleted_at = now() - interval '31 days', trash_root = id where id = pg_temp.got('b_fan')::uuid;
  perform pg_temp.act_as('mt_edit');
  perform public.maps_list();
  reset role;
  perform pg_temp.check(not exists (select 1 from maps.maps where id = v_new), 'old trashed map purged');
  perform pg_temp.check(not exists (select 1 from maps.branches where id = pg_temp.got('b_fan')::uuid), 'old trashed branch purged');

  -- ---------------------------------------------------------------- 002: the schema holds a flowchart (screens in step 3)
  perform pg_temp.check((select t ->> 'name' from jsonb_array_elements(public.maps_types()) t where t ->> 'id' = 'decision') = 'Decision', 'shapes listed');
  perform pg_temp.check(maps.clean_props('decision', 'flowchart', '{"lane": " Sales "}') = '{"lane": "Sales"}', 'lane kept, trimmed');
  perform pg_temp.check(maps.clean_props('general', 'flowchart', null) = '{}', 'general lives in a flowchart');
  perform pg_temp.expect_error('select maps.clean_props(''decision'', ''knowledge'', null)', 'INVALID:type');
  perform pg_temp.expect_error(format('select maps.clean_props(''process'', ''flowchart'', %L)', jsonb_build_object('lane', repeat('x', 41))), 'INVALID:props');
  perform pg_temp.expect_error('select maps.clean_props(''process'', ''flowchart'', ''{"flow": 12}'')', 'INVALID:props');
  declare v_fc uuid; v_r uuid; v_s uuid; v_d uuid; v_e uuid; v_u uuid := (select id from t_ids where k = 'mt_edit');
  begin
    insert into maps.maps (name, kind, owner_id, owner_name) values ('Approval', 'flowchart', v_u, 'Mt Edit') returning id into v_fc;
    insert into maps.branches (map_id, title) values (v_fc, 'Approval') returning id into v_r;
    insert into maps.branches (map_id, parent_id, title, type, props, place) values (v_fc, v_r, 'Start', 'start', '{"lane": "Sales"}', '{"x": 0, "y": 0}') returning id into v_s;
    insert into maps.branches (map_id, parent_id, title, type, props) values (v_fc, v_r, 'Standard product?', 'decision', '{"lane": "Sales"}') returning id into v_d;
    insert into maps.branches (map_id, parent_id, title, type) values (v_fc, v_r, 'End', 'end') returning id into v_e;
    insert into maps.lines (map_id, from_id, to_id, kind, rel, label) values
      (v_fc, v_s, v_d, 'flow', 'next', ''), (v_fc, v_d, v_e, 'flow', 'next', 'Yes'), (v_fc, v_d, v_s, 'flow', 'next', 'No');
    perform pg_temp.check((select count(*) from maps.lines where map_id = v_fc and kind = 'flow') = 3, 'flow lines held, loop included');
    perform pg_temp.expect_error(format('insert into maps.lines (map_id, from_id, kind, rel) values (%L, %L, ''flow'', ''next'')', v_fc, v_d), 'new row for relation "lines" violates check constraint "lines_to_check"');
    perform pg_temp.expect_error(format('insert into maps.lines (map_id, from_id, to_id, kind, rel) values (%L, %L, %L, ''arrow'', ''next'')', v_fc, v_d, v_e), 'new row for relation "lines" violates check constraint "lines_kind_check"');
    perform pg_temp.expect_error(format('update maps.maps set kind = ''mindmap'' where id = %L', v_fc), 'new row for relation "maps" violates check constraint "maps_kind_check"');
    delete from maps.maps where id = v_fc;
  end;

  -- ---------------------------------------------------------------- the browser roles reach nothing directly
  perform set_config('role', 'authenticated', true);
  perform pg_temp.expect_error('select count(*) from maps.maps', 'PERMISSION');
  perform pg_temp.expect_error('select maps.right_of(null, true, true, null, ''team_edit'')', 'PERMISSION');
  reset role;

  perform pg_temp.check((select count(*) from core.security_check()) = 0, 'security_check reports a problem');
  raise notice 'ALL MAPS TESTS PASSED';
end $$;

rollback;
