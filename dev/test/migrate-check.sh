#!/bin/bash
# Live-like check of 006 (local only, never run on Supabase): the core up to 010, Maps with its old rights, maps 001-005,
# maps made with every old sharing; what each person may do on each map is noted; then core 011 and maps 006 run as on
# live, and the same is noted again. The only differences allowed are the two the owner decided (2026-11-06):
#   - the tile's manager now opens private maps (and a map whose maker's account is gone),
#   - level approve includes contribute: a verifier without 'edit' may now change a map shared to edit.
#   MIG_PGARGS default "-h /tmp -p 5499 -U postgres -d dame_maps_mig" (its own database: never the one dev/test/db.sh fills)
#   DAME_HUB default ../dame-hub
set -e
cd "$(dirname "$0")/../.."
: "${MIG_PGARGS:=-h /tmp -p 5499 -U postgres -d dame_maps_mig}"
PGARGS="$MIG_PGARGS"
: "${DAME_HUB:=../dame-hub}"
DB=$(echo "$PGARGS" | sed -n 's/.*-d \([^ ]*\).*/\1/p')
ADMIN=$(echo "$PGARGS" | sed "s/-d $DB/-d postgres/")
psql $ADMIN -qc "drop database if exists $DB" ; psql $ADMIN -qc "create database $DB"
run() { psql $PGARGS -q -v ON_ERROR_STOP=1 -f "$1" > /dev/null 2>&1 || { psql $PGARGS -q -v ON_ERROR_STOP=1 -f "$1"; exit 1; }; }
run "$DAME_HUB/dev/test/supabase-stub.sql"
for f in "$DAME_HUB"/db/core/0*.sql; do case "$f" in *011_*|*012_*|*013_*) ;; *) run "$f";; esac; done
psql $PGARGS -qc "insert into core.tiles (id, name, tagline, icon, enabled, rights) values ('maps', 'Maps', 'Maps', 'map', true, array['edit','verify'])"
for f in db/maps/00[1-5]_*.sql; do run "$f"; done

psql $PGARGS -q -v ON_ERROR_STOP=1 <<'SQL'
create schema mig;
create table mig.users (k text primary key, id uuid);
create table mig.maps (k text primary key, id uuid);
create table mig.seen (phase text, u text, m text, r text);
grant usage on schema mig to public; grant all on all tables in schema mig to public;
do $$
declare v_name text; v_id uuid;
begin
  foreach v_name in array array['mg_admin', 'mg_owner', 'mg_edit', 'mg_verify', 'mg_both', 'mg_read', 'mg_gone'] loop
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_name || '@users.dame-hub.local', '', now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('username', v_name, 'display_name', v_name), now(), now(), '', '', '', '', '', '', '', '');
    insert into mig.users values (v_name, v_id);
  end loop;
  update core.profiles set status = 'active' where username like 'mg\_%';
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', true, '{}' from mig.users where k = 'mg_admin';
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', false, array['edit'] from mig.users where k in ('mg_owner', 'mg_edit', 'mg_gone');
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', false, array['verify'] from mig.users where k = 'mg_verify';
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', false, array['edit', 'verify'] from mig.users where k = 'mg_both';
  insert into core.tile_access (user_id, tile_id, is_admin, rights) select id, 'maps', false, '{}' from mig.users where k = 'mg_read';
end $$;

create function mig.act_as(p_key text) returns void language plpgsql as $$
declare v_id uuid; v_sid uuid := gen_random_uuid();
begin
  execute 'reset role';
  select id into v_id from mig.users where k = p_key;
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, v_id, now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'session_id', v_sid, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
  perform public.core_session_start();
end $$;
grant execute on function mig.act_as(text) to public;

-- the maps, made through the old functions
select mig.act_as('mg_owner');
insert into mig.maps select 'private', (public.maps_create('Private map', 'knowledge', 'private', null) ->> 'id')::uuid;
insert into mig.maps select 'team_read', (public.maps_create('Team read map', 'knowledge', 'team_read', null) ->> 'id')::uuid;
insert into mig.maps select 'team_edit', (public.maps_create('Team edit map', 'flowchart', 'team_edit', null) ->> 'id')::uuid;
insert into mig.maps select 'trashed', (public.maps_create('Trashed map', 'knowledge', 'team_edit', null) ->> 'id')::uuid;
select public.maps_map_delete(id) from mig.maps where k = 'trashed';
select mig.act_as('mg_gone');
insert into mig.maps select 'gone_private', (public.maps_create('Maker gone', 'knowledge', 'private', null) ->> 'id')::uuid;
insert into mig.maps select 'gone_shared', (public.maps_create('Maker gone, shared', 'knowledge', 'team_edit', null) ->> 'id')::uuid;
reset role;
-- the maker of the last two leaves (as the super user's Delete did before 011: his maps stay)
delete from auth.users where id = (select id from mig.users where k = 'mg_gone');
delete from mig.users where k = 'mg_gone';
SQL

# What each person may do on each map: maps_get right, NOT_FOUND, or (trashed map) whether he may restore it.
note() {
psql $PGARGS -q -v ON_ERROR_STOP=1 <<SQL
do \$\$
declare u record; m record; v text;
begin
  for u in select k from mig.users order by k loop
    perform mig.act_as(u.k);
    for m in select k, id from mig.maps order by k loop
      begin
        if m.k = 'trashed' then
          v := case when exists (select 1 from jsonb_array_elements(public.maps_trash() -> 'maps') x where (x ->> 'id')::uuid = m.id) then 'can restore' else 'no trash' end;
        else
          v := public.maps_get(m.id) -> 'map' ->> 'right';
          if v in ('read', 'edit', 'manage') then
            begin
              perform public.maps_branch_add((select (b ->> 'id')::uuid from jsonb_array_elements(public.maps_get(m.id) -> 'branches') b where b ->> 'parent' is null), 'probe');
              v := v || ', adds';
            exception when others then v := v || ', ' || sqlerrm;
            end;
          end if;
        end if;
      exception when others then v := sqlerrm;
      end;
      insert into mig.seen values ('$1', u.k, m.k, v);
    end loop;
    reset role;
  end loop;
  -- probes out again, so both phases start alike
  delete from maps.branches where title = 'probe';
end \$\$;
SQL
}
note before
run "$DAME_HUB/db/core/011_access.sql"
run db/maps/006_access.sql
note after

psql $PGARGS -At <<'SQL'
select format('%-10s %-13s %-28s -> %s%s', b.u, b.m, b.r, a.r,
  case when b.r = a.r then ''
       when b.u = 'mg_admin' and b.m in ('private', 'gone_private') and a.r = 'manage, adds' then '   (owner 2026-11-06: managers open private maps)'
       when b.u = 'mg_verify' and b.m in ('team_edit', 'gone_shared') and a.r = 'edit, adds' then '   (approve includes contribute)'
       else '   <-- UNEXPECTED' end)
from mig.seen b join mig.seen a on a.phase = 'after' and a.u = b.u and a.m = b.m where b.phase = 'before' order by b.u, b.m;
select case when count(*) = 0 then 'MIGRATION CHECK PASSED' else count(*) || ' UNEXPECTED DIFFERENCE(S)' end
from mig.seen b join mig.seen a on a.phase = 'after' and a.u = b.u and a.m = b.m
where b.phase = 'before' and b.r <> a.r
  and not (b.u = 'mg_admin' and b.m in ('private', 'gone_private') and a.r = 'manage, adds')
  and not (b.u = 'mg_verify' and b.m in ('team_edit', 'gone_shared') and a.r = 'edit, adds');
select 'containers: ' || string_agg(format('%s everyone=%s owner=%s', m.k, coalesce(c.everyone, '(only listed)'), coalesce(p.username, '(none)')), '; ' order by m.k)
from mig.maps m join core.containers c on c.tile_id = 'maps' and c.id = m.id::text left join core.profiles p on p.id = c.owner_id;
select 'declared: ' || (access -> 'kinds')::text || ' aliases ' || (access -> 'aliases')::text || ' rights ' || rights::text from core.tiles where id = 'maps';
SQL
psql $PGARGS -qc "drop schema mig cascade"
psql $PGARGS -Atc "select count(*) || ' security problem(s)' from core.security_check()"
