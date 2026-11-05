-- Maps tile tests. Run on STAGING after db/maps/001_init.sql (while there is no staging project, the owner decides).
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

  -- ---------------------------------------------------------------- the browser roles reach nothing directly
  perform set_config('role', 'authenticated', true);
  perform pg_temp.expect_error('select count(*) from maps.maps', 'PERMISSION');
  perform pg_temp.expect_error('select maps.right_of(null, true, true, null, ''team_edit'')', 'PERMISSION');
  reset role;

  perform pg_temp.check((select count(*) from core.security_check()) = 0, 'security_check reports a problem');
  raise notice 'ALL MAPS TESTS PASSED';
end $$;

rollback;
