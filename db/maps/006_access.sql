-- Maps tile 006: the core's access model (core 011; dame-hub docs/TILE-CONTRACT.md section 5, docs/TILE-CHANGES.md 2026-11-06).
-- Run after core 011_access and maps 005_process_flow. Read it, then paste it whole in the SQL editor.
-- Then: Admin > Health > Run check now (Clean), then the Security Advisor.
-- Touches only: the maps declaration, maps' containers (kind 'map'), schema maps, functions public.maps_*.
--
--   1. Maps declares itself: what each level means here; no aliases (every check below is a level now).
--   2. Every map, those in the trash too, becomes a container 'map' in the core: owner = who made it (none if that
--      account is gone); "only me" -> only the owner and the people he adds, "team can read" -> everyone in Maps can
--      view, "team can edit" -> everyone in Maps can edit. Nobody loses or gains anything, except (owner, 2026-11-06)
--      the tile's managers, who now open every map, private ones too.
--   3. maps.maps.share goes: who may open a map lives only in the core (the Access panel, Core.share). maps.maps.owner_id
--      stays as "made by" (it keeps map names unique per maker); the map's owner is the container's owner, which a
--      manager may change (Access > Change owner, Admin > Handover).
--   4. What someone may do on a map comes from core.container_level:
--        none   he may not open it (NOT_FOUND)
--        read   Can view, or his level in Maps is read
--        edit   shared to edit (everyone, him, or a group of his) and his level is contribute or more
--        manage the owner with contribute or more, or a manager of Maps: settings, Share, delete, trash
--      Verifying: level approve and a map he may open (as before: verifying is not editing).
--   5. Renaming a map renames its container; a map purged from the trash takes its container with it.

do $$
begin
  if to_regprocedure('core.container_level(uuid, text, text, text)') is null then
    raise exception 'Run dame-hub db/core/011_access.sql first.';
  end if;
  if not exists (select 1 from core.migrations m where m.repo = 'maps' and m.name = '005_process_flow') then
    raise exception 'Run db/maps/003, 004 and 005 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The declaration (replaces the first one core 011 wrote for maps)
-- ---------------------------------------------------------------------------
select core.tile_declare('maps', '{
  "levels": {
    "read": "Open and read the maps shared with him",
    "contribute": "Add maps and share his own; change the maps shared with him to edit; import",
    "edit": "As contribute (Maps has no separate step here)",
    "approve": "Also verify branches in the maps he may open, the Review list, send back",
    "manage": "Every map, private ones too: change, share, change owner, settings, trash; people and access of the tile"
  },
  "kinds": { "map": "Map" },
  "default": "contribute"
}');

-- ---------------------------------------------------------------------------
-- 2. Every map becomes a container (the trash too: it can be restored)
-- ---------------------------------------------------------------------------
select count(core.container_put('maps', 'map', m.id::text, m.name,
         case m.share when 'team_edit' then 'edit' when 'team_read' then 'read' end,
         (select p.id from core.profiles p where p.id = m.owner_id)))
from maps.maps m;

-- ---------------------------------------------------------------------------
-- 3. Helpers (schema maps; never callable from the browser)
-- ---------------------------------------------------------------------------

-- The caller's standing in the tile, read once per call. p_right: a level, or the words 001-005 pass:
-- 'edit' = contribute (add maps, import), 'verify' = approve.
create or replace function maps.ctx(p_right text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles; v_level text; v_rank integer;
begin
  if p_right is null then
    v_user := core.require_tile('maps', null);
  else
    v_user := core.require_level('maps', case p_right when 'edit' then 'contribute' when 'verify' then 'approve' else p_right end);
  end if;
  v_level := core.tile_level(v_user.id, 'maps');
  v_rank := core.level_rank(v_level);
  return jsonb_build_object('id', v_user.id, 'name', v_user.display_name, 'username', v_user.username, 'level', v_level,
    'editor', v_rank >= 2, 'verifier', v_rank >= 4, 'admin', v_rank >= 5);
end $$;

-- What the caller may do on a map, from what the core says about its container (core.container_info: null when he may
-- not open it). The only place map rights are decided.
create or replace function maps.right_from(p_info jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_info is null or p_info ->> 'level' is null then 'none'
    when p_info ->> 'level' = 'manage' then 'manage'
    when coalesce((p_info ->> 'mine')::boolean, false) then case when core.level_rank(p_info ->> 'level') >= 2 then 'manage' else 'read' end
    when core.level_rank(p_info ->> 'level') >= 2 then 'edit'
    else 'read' end;
$$;

create or replace function maps.right_on(p_ctx jsonb, p_map maps.maps)
returns text language plpgsql security definer set search_path = '' stable as $$
begin
  return maps.right_from(core.container_info('maps', 'map', p_map.id::text));
end $$;

drop function if exists maps.right_of(uuid, boolean, boolean, uuid, text);

-- A map as lists and the map page show it: owner, who may open it, what the caller may do there.
create or replace function maps.map_head(p_map maps.maps, p_info jsonb, p_names jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_map.id, 'name', p_map.name, 'kind', p_map.kind,
    'mine', coalesce((p_info ->> 'mine')::boolean, false),
    'owner', coalesce(p_info ->> 'owner_name', p_map.owner_name),
    'everyone', p_info ->> 'everyone', 'shared', coalesce((p_info ->> 'shared')::integer, 0),
    'right', maps.right_from(p_info), 'updated_at', p_map.updated_at,
    'updated_by', coalesce(p_names ->> p_map.updated_by::text, p_map.updated_by_name));
$$;

-- Renaming a map renames its container. A container should always be there; if it ever is not, it is made private
-- (owner: the maker, or whoever renamed it), never wider.
create or replace function maps.container_rename()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform core.container_put('maps', 'map', new.id::text, new.name, null,
    (select p.id from core.profiles p where p.id = new.owner_id));
  return null;
end $$;
drop trigger if exists maps_container_rename on maps.maps;
create trigger maps_container_rename after update of name on maps.maps
  for each row when (old.name is distinct from new.name) execute function maps.container_rename();

-- A map gone for good (purged from the trash) takes its container and its shares with it.
create or replace function maps.container_gone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform core.container_drop('maps', 'map', old.id::text);
  return null;
end $$;
drop trigger if exists maps_container_gone on maps.maps;
create trigger maps_container_gone after delete on maps.maps
  for each row execute function maps.container_gone();

-- ---------------------------------------------------------------------------
-- 4. Sharing leaves the tile's tables
-- ---------------------------------------------------------------------------
drop function if exists public.maps_create(text, text, text, jsonb);
drop function if exists public.maps_map_save(uuid, integer, text, text);
alter table maps.maps drop column share;

-- ---------------------------------------------------------------------------
-- 5. Functions the pages call (only those that change; the rest read rights through maps.ctx / maps.right_on)
-- ---------------------------------------------------------------------------

-- Every map the caller may open, latest change first, with what it holds and what he may do.
create or replace function public.maps_list()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_open text[]; v_maps jsonb; v_names jsonb;
begin
  v_ctx := maps.ctx();
  perform maps.purge();
  v_open := array(select core.container_ids('maps', 'map'));
  select maps.names(array_agg(m.updated_by)) into v_names from maps.maps m where m.deleted_at is null and m.id::text = any (v_open);
  select coalesce(jsonb_agg(x.j order by x.updated_at desc, x.id), '[]') into v_maps from (
    select m.id, m.updated_at, maps.map_head(m, core.container_info('maps', 'map', m.id::text), v_names) || jsonb_build_object(
      'branches', (select count(*) from maps.branches b where b.map_id = m.id and b.deleted_at is null and b.parent_id is not null),
      'to_verify', (select count(*) from maps.branches b where b.map_id = m.id and b.deleted_at is null and b.parent_id is not null
                      and (not b.verified or b.verified_fact is distinct from maps.fact(b.id)))) j
    from maps.maps m
    where m.deleted_at is null and m.id::text = any (v_open)
  ) x;
  return jsonb_build_object('maps', v_maps,
    'me', jsonb_build_object('level', v_ctx ->> 'level', 'editor', (v_ctx ->> 'editor')::boolean,
                             'verifier', (v_ctx ->> 'verifier')::boolean, 'admin', (v_ctx ->> 'admin')::boolean));
end $$;
revoke execute on function public.maps_list() from public, anon;
grant execute on function public.maps_list() to authenticated;

-- Words in every map the caller may open: branch names first, then special notes, then notes. At most 60 branches.
create or replace function public.maps_search(p_q text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_q text := lower(btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g'))); v_pat text; v_open text[];
begin
  v_ctx := maps.ctx();
  if char_length(v_q) < 2 then return '[]'::jsonb; end if;
  if char_length(v_q) > 100 then raise exception 'INVALID:q'; end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_open := array(select core.container_ids('maps', 'map'));
  return coalesce((select jsonb_agg(h.j order by h.rank, h.map_name, h.title) from (
    select x.rank, x.map_name, x.title, jsonb_build_object('map_id', x.map_id, 'map', x.map_name, 'branch_id', x.id, 'title', x.title,
      'in', case x.rank when 1 then 'name' when 2 then 'special note' else 'notes' end,
      'text', case x.rank when 1 then ''
                          when 2 then (select s from unnest(x.special) s where lower(s) like v_pat escape '\' limit 1)
                          else (case when strpos(lower(x.notes), v_q) > 41 then '... ' else '' end)
                               || regexp_replace(substr(x.notes, greatest(strpos(lower(x.notes), v_q) - 40, 1), 160), '\s+', ' ', 'g') end) j
    from (
      select b.id, b.map_id, m.name as map_name, b.title, b.notes, b.special,
        case when lower(b.title) like v_pat escape '\' then 1
             when lower(array_to_string(b.special, E'\n')) like v_pat escape '\' then 2 else 3 end as rank
      from maps.branches b join maps.maps m on m.id = b.map_id
      where b.deleted_at is null and m.deleted_at is null and m.id::text = any (v_open)
        and (lower(b.title) like v_pat escape '\' or lower(b.notes) like v_pat escape '\'
             or lower(array_to_string(b.special, E'\n')) like v_pat escape '\')
      order by 7, m.name, b.title limit 60
    ) x
  ) h), '[]'::jsonb);
end $$;
revoke execute on function public.maps_search(text) from public, anon;
grant execute on function public.maps_search(text) to authenticated;

-- A new map: knowledge or flowchart (piping and wiring come in steps 4 and 5). Level contribute.
-- p_everyone: who else may open it - 'edit' (everyone in Maps can edit), 'read' (everyone can view) or 'none' (only
-- the owner and the people he adds in Access). The centre branch carries the map's name. p_items: a starter template,
-- added the same way as Import (everything in it "to verify").
create function public.maps_create(p_name text, p_kind text, p_everyone text, p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_name text; v_map maps.maps; v_root uuid; v_n integer; v_add jsonb; v_kind text := coalesce(p_kind, 'knowledge');
  v_everyone text := coalesce(p_everyone, 'none');
begin
  v_ctx := maps.ctx('contribute'); v_uid := (v_ctx ->> 'id')::uuid;
  v_name := maps.clean_title(p_name, 80);
  if v_kind not in ('knowledge', 'flowchart') then raise exception 'INVALID:kind'; end if;
  if v_everyone not in ('edit', 'read', 'none') then raise exception 'INVALID:everyone'; end if;
  if exists (select 1 from maps.maps m where m.owner_id = v_uid and m.deleted_at is null and lower(m.name) = lower(v_name)) then
    raise exception 'INVALID:name_taken';
  end if;
  select count(*) into v_n from maps.maps m where m.owner_id = v_uid and m.deleted_at is null;
  if v_n >= 200 then raise exception 'INVALID:too_many'; end if;
  insert into maps.maps (name, kind, owner_id, owner_name, updated_by, updated_by_name)
  values (v_name, v_kind, v_uid, v_ctx ->> 'name', v_uid, v_ctx ->> 'name')
  returning * into v_map;
  perform core.container_put('maps', 'map', v_map.id::text, v_name, nullif(v_everyone, 'none'), v_uid);
  insert into maps.branches (map_id, parent_id, title, verified, verified_by, verified_by_name, verified_at, created_by, created_by_name, updated_by, updated_by_name)
  values (v_map.id, null, v_name, true, v_uid, v_ctx ->> 'name', now(), v_uid, v_ctx ->> 'name', v_uid, v_ctx ->> 'name')
  returning id into v_root;
  update maps.branches set verified_fact = maps.fact(id) where id = v_root;
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    v_add := maps.add_items(v_ctx, v_map, v_root, p_items);
    -- a flowchart keeps the lanes of its steps in the order they are first used (moving a step does not reorder them)
    if v_kind = 'flowchart' then
      update maps.branches set props = maps.clean_props('general', 'flowchart', jsonb_build_object('lanes', l.lanes)), verified_fact = null
      from (select jsonb_agg(x.lane order by x.first) lanes from (
              select b.props ->> 'lane' lane, min(b.created_at) first from maps.branches b
              where b.map_id = v_map.id and b.parent_id is not null and b.props ? 'lane' group by b.props ->> 'lane' limit 12) x) l
      where id = v_root and l.lanes is not null;
      update maps.branches set verified_fact = maps.fact(id) where id = v_root;
    end if;
  end if;
  perform maps.log(v_ctx, v_map.id, null, null, 'map_create', null,
    jsonb_build_object('name', v_map.name, 'kind', v_map.kind, 'everyone', v_everyone, 'starter', coalesce((v_add ->> 'added')::integer, 0)));
  perform core.audit('maps', 'map_create', jsonb_build_object('map', v_map.id, 'kind', v_map.kind, 'everyone', v_everyone));
  return jsonb_build_object('id', v_map.id);
end $$;
revoke execute on function public.maps_create(text, text, text, jsonb) from public, anon;
grant execute on function public.maps_create(text, text, text, jsonb) to authenticated;

-- One map with its branches and lines. Lines to or from a map the caller may not open are left out.
create or replace function public.maps_get(p_map uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_map maps.maps; v_names jsonb; v_branches jsonb; v_lines jsonb; v_changed jsonb; v_open text[]; v_info jsonb;
begin
  v_ctx := maps.ctx();
  v_map := maps.map_for(v_ctx, p_map, 'read');
  v_info := core.container_info('maps', 'map', v_map.id::text);
  v_open := array(select core.container_ids('maps', 'map'));
  select maps.names(array[v_map.updated_by] || coalesce(array_agg(b.updated_by), '{}') || coalesce(array_agg(b.verified_by), '{}')
                    || coalesce(array_agg(b.created_by), '{}'))
    into v_names from maps.branches b where b.map_id = v_map.id and b.deleted_at is null;
  select coalesce(jsonb_agg(maps.branch_json(b, v_names) order by b.sort, b.created_at, b.id), '[]') into v_branches
  from maps.branches b where b.map_id = v_map.id and b.deleted_at is null;
  -- the fact each "changed since verified" branch was verified with, to show the difference
  select coalesce(jsonb_object_agg(x ->> 'id', b.verified_fact), '{}') into v_changed
  from jsonb_array_elements(v_branches) x join maps.branches b on b.id = (x ->> 'id')::uuid
  where x ->> 'status' = 'changed';
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'version', l.version, 'from', l.from_id, 'to', l.to_id, 'kind', l.kind,
      'rel', l.rel, 'circuit', l.circuit, 'label', l.label, 'target', l.target, 'props', l.props, 'sort', l.sort,
      'other', case when fb.map_id <> v_map.id then jsonb_build_object('map_id', fm.id, 'map', fm.name, 'title', fb.title)
                    when tb.map_id is not null and tb.map_id <> v_map.id then jsonb_build_object('map_id', tm.id, 'map', tm.name, 'title', tb.title) end)
      order by l.sort, l.created_at, l.id), '[]') into v_lines
  from maps.lines l
  join maps.branches fb on fb.id = l.from_id and fb.deleted_at is null
  join maps.maps fm on fm.id = fb.map_id and fm.deleted_at is null
  left join maps.branches tb on tb.id = l.to_id
  left join maps.maps tm on tm.id = tb.map_id
  where (fb.map_id = v_map.id or tb.map_id = v_map.id)
    and (l.to_id is null or (tb.deleted_at is null and tm.deleted_at is null))
    and fm.id::text = any (v_open) and (tm.id is null or tm.id::text = any (v_open));
  return jsonb_build_object(
    'map', maps.map_head(v_map, v_info, v_names) || jsonb_build_object('version', v_map.version,
      'can_verify', (v_ctx ->> 'verifier')::boolean, 'can_share', maps.right_from(v_info) = 'manage'),
    'branches', v_branches, 'lines', v_lines, 'verified_facts', v_changed);
end $$;
revoke execute on function public.maps_get(uuid) from public, anon;
grant execute on function public.maps_get(uuid) to authenticated;

-- Map settings (whoever manages the map): its name. Who may open it is set in Access (Core.share), not here.
create function public.maps_map_save(p_map uuid, p_version integer, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_map maps.maps; v_name text;
begin
  v_ctx := maps.ctx();
  v_map := maps.map_for(v_ctx, p_map, 'manage');
  if p_version is distinct from v_map.version then
    raise exception 'INVALID:version' using detail = jsonb_build_object('by', v_map.updated_by_name, 'at', v_map.updated_at)::text;
  end if;
  v_name := case when p_name is null then v_map.name else maps.clean_title(p_name, 80) end;
  if lower(v_name) <> lower(v_map.name) and exists (select 1 from maps.maps m where m.owner_id = v_map.owner_id and m.deleted_at is null
       and lower(m.name) = lower(v_name) and m.id <> v_map.id) then
    raise exception 'INVALID:name_taken';
  end if;
  if v_name = v_map.name then return jsonb_build_object('version', v_map.version); end if;
  update maps.maps set name = v_name, version = version + 1, updated_at = now(),
    updated_by = (v_ctx ->> 'id')::uuid, updated_by_name = v_ctx ->> 'name' where id = v_map.id;
  update maps.branches set title = v_name, version = version + 1, updated_at = now(),
    updated_by = (v_ctx ->> 'id')::uuid, updated_by_name = v_ctx ->> 'name'
  where map_id = v_map.id and parent_id is null;
  perform maps.log(v_ctx, v_map.id, null, null, 'map_settings', jsonb_build_object('name', v_map.name), jsonb_build_object('name', v_name));
  return jsonb_build_object('version', v_map.version + 1);
end $$;
revoke execute on function public.maps_map_save(uuid, integer, text) from public, anon;
grant execute on function public.maps_map_save(uuid, integer, text) to authenticated;

-- Nothing in schema maps is callable by the browser roles.
revoke execute on all functions in schema maps from public, anon, authenticated;

select core.applied('maps', '006_access');
