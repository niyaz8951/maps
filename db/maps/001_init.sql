-- Maps tile, step 1: foundation and knowledge maps.
-- Touches only: schema maps, functions public.maps_*. No bucket (no files are stored).
-- Needs the core up to 008 and the tile 'maps' registered in Admin > Tiles (rights: edit, verify).
-- Read it, then paste it whole in the SQL editor. Then: select * from core.security_check();  (no rows)
--
-- Model (tile decisions 2026-11-05, project instructions):
--   maps.maps      a map: name, kind (knowledge | piping | wiring), share (private | team_read | team_edit), owner, version, trash.
--   maps.branches  the tree: title, notes, special notes (for people), type + typed properties (SI, checked here),
--                  place {x, y, w, h} (2D view, step 3), verification with the fact verified, version, trash.
--   maps.lines     links, pipes, wires and control lines as rows (from branch, to branch, kind, relation, properties),
--                  and web / tile links (no "to" branch, a target). A line to a branch of another map is shown only to
--                  someone who may open both maps.
--   maps.history   every change: who, when, before, after. Typing in one branch for a while is one entry.
--   maps.types     the branch types and the properties each one takes (only 'general' in step 1).
-- Rights: 'edit' = add maps, edit own and team-edit maps, import; 'verify' = verify branches. With the tile and no right:
-- read team maps and own maps. The owner (with 'edit'), a tile admin and the super user manage a shared map (settings,
-- delete, restore); a private map is its owner's only. Tile admins and the super user hold every right (core rule).
-- Trash: deleted maps and branches stay 30 days, restorable by whoever manages the map; purged when the tile is used.
-- Clash guard: every save carries the version the page read; a newer one is refused with INVALID:version and the
-- name of who changed it (in the error detail).

create schema if not exists maps;
revoke all on schema maps from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS on, no policies: only the functions below read and write them)
-- ---------------------------------------------------------------------------
create table maps.types (
  id     text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),
  name   text not null check (char_length(name) between 1 and 40),
  kinds  text[] not null,            -- the map kinds a branch of this type may live in
  props  jsonb not null default '{}', -- { key: { kind: number|enum|text|bool, unit, min, max, values, max_len } }
  sort   integer not null default 100
);
alter table maps.types enable row level security;

insert into maps.types (id, name, kinds, props, sort) values
  ('general', 'General', array['knowledge', 'piping', 'wiring'],
   '{"layout": {"kind": "enum", "values": ["tree", "columns"], "label": "Layout"}}', 0);

create table maps.maps (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  kind            text not null default 'knowledge' check (kind in ('knowledge', 'piping', 'wiring')),
  share           text not null default 'private' check (share in ('private', 'team_read', 'team_edit')),
  owner_id        uuid not null,     -- no foreign key: an account can be deleted, its maps stay (core rule)
  owner_name      text not null,     -- the name at the time; the current one comes from core.display_names
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text,
  deleted_at      timestamptz,
  deleted_by      uuid,
  deleted_by_name text
);
alter table maps.maps enable row level security;
create unique index maps_owner_name_idx on maps.maps (owner_id, lower(name)) where deleted_at is null;
create index maps_deleted_idx on maps.maps (deleted_at) where deleted_at is not null;

create table maps.branches (
  id               uuid primary key default gen_random_uuid(),
  map_id           uuid not null references maps.maps (id) on delete cascade,
  parent_id        uuid references maps.branches (id) on delete cascade,
  sort             integer not null default 0,
  title            text not null check (char_length(title) between 1 and 120),
  notes            text not null default '' check (char_length(notes) <= 8000),
  special          text[] not null default '{}' check (cardinality(special) <= 20),
  type             text not null default 'general' references maps.types (id),
  props            jsonb not null default '{}' check (jsonb_typeof(props) = 'object'),
  place            jsonb check (place is null or jsonb_typeof(place) = 'object'),
  verified         boolean not null default false,
  verified_by      uuid,
  verified_by_name text,
  verified_at      timestamptz,
  verified_fact    jsonb,            -- what was verified (title, notes, special notes, type, properties, lines out)
  version          integer not null default 1,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text,
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid,
  deleted_by_name  text,
  trash_root       uuid              -- the branch the delete was made on (it and everything under it went together)
);
alter table maps.branches enable row level security;
create index branches_map_idx on maps.branches (map_id);
create index branches_parent_idx on maps.branches (parent_id);
create unique index branches_root_idx on maps.branches (map_id) where parent_id is null;
create index branches_deleted_idx on maps.branches (deleted_at) where deleted_at is not null;

create table maps.lines (
  id              uuid primary key default gen_random_uuid(),
  map_id          uuid not null references maps.maps (id) on delete cascade,      -- the map of the "from" branch
  from_id         uuid not null references maps.branches (id) on delete cascade,
  to_id           uuid references maps.branches (id) on delete cascade,           -- null for web and tile links
  kind            text not null check (kind in ('link', 'pipe', 'wire', 'control', 'web', 'tile')),
  rel             text not null check (rel ~ '^[a-z][a-z0-9-]{0,30}$'),
  circuit         text check (circuit is null or circuit ~ '^[a-z][a-z0-9-]{0,20}$'),
  label           text not null default '' check (char_length(label) <= 120),
  target          text check (target is null or char_length(target) <= 500),    -- web: https URL; tile: <tile-id>/<path>
  props           jsonb not null default '{}' check (jsonb_typeof(props) = 'object'),
  sort            integer not null default 0,
  version         integer not null default 1,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  check ((to_id is not null) = (kind in ('link', 'pipe', 'wire', 'control'))),
  check ((target is not null) = (kind in ('web', 'tile'))),
  check (to_id is null or to_id <> from_id)
);
alter table maps.lines enable row level security;
create index lines_from_idx on maps.lines (from_id);
create index lines_to_idx on maps.lines (to_id);
create index lines_map_idx on maps.lines (map_id);

create table maps.history (
  id        bigint generated always as identity primary key,
  map_id    uuid not null references maps.maps (id) on delete cascade,
  branch_id uuid,                    -- no foreign key: the entry outlives a purged branch until its map goes
  line_id   uuid,
  action    text not null,
  before    jsonb,
  after     jsonb,
  by_id     uuid,
  by_name   text,
  at        timestamptz not null default now()
);
alter table maps.history enable row level security;
create index history_map_idx on maps.history (map_id, id desc);
create index history_branch_idx on maps.history (branch_id, id desc);

-- The browser roles never touch the tables directly.
revoke all on all tables in schema maps from public, anon, authenticated;
revoke all on all sequences in schema maps from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (schema maps; never callable from the browser)
-- ---------------------------------------------------------------------------

-- What a user may do on a map: 'manage' (settings, delete, restore; implies edit), 'edit', 'read' or 'none'.
-- p_editor = has the right 'edit'; p_admin = tile admin or super user. The only place map rights are decided.
create or replace function maps.right_of(p_uid uuid, p_editor boolean, p_admin boolean, p_owner uuid, p_share text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_owner = p_uid then case when p_editor then 'manage' else 'read' end
    when p_share = 'private' then 'none'
    when p_admin then 'manage'
    when p_share = 'team_edit' and p_editor then 'edit'
    else 'read' end;
$$;

-- The caller's standing in the tile, read once per call.
create or replace function maps.ctx(p_right text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user core.profiles;
begin
  v_user := core.require_tile('maps', p_right);
  return jsonb_build_object('id', v_user.id, 'name', v_user.display_name, 'username', v_user.username,
    'editor', core.has_tile(v_user.id, 'maps', 'edit'), 'verifier', core.has_tile(v_user.id, 'maps', 'verify'),
    'admin', core.is_tile_admin(v_user.id, 'maps'));
end $$;

create or replace function maps.right_on(p_ctx jsonb, p_map maps.maps)
returns text language sql stable set search_path = '' as $$
  select maps.right_of((p_ctx ->> 'id')::uuid, (p_ctx ->> 'editor')::boolean, (p_ctx ->> 'admin')::boolean, p_map.owner_id, p_map.share);
$$;

-- A live map the caller may at least read; 'edit' / 'manage' asked: NO_RIGHT when he may only read.
-- Missing, deleted or private to someone else: NOT_FOUND (never a hint that it exists).
create or replace function maps.map_for(p_ctx jsonb, p_map uuid, p_need text)
returns maps.maps language plpgsql security definer set search_path = '' as $$
declare v_map maps.maps; v_right text;
begin
  select * into v_map from maps.maps m where m.id = p_map and m.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_right := maps.right_on(p_ctx, v_map);
  if v_right = 'none' then raise exception 'NOT_FOUND'; end if;
  if p_need = 'edit' and v_right not in ('edit', 'manage') then raise exception 'NO_RIGHT'; end if;
  if p_need = 'manage' and v_right <> 'manage' then raise exception 'NO_RIGHT'; end if;
  return v_map;
end $$;

create or replace function maps.branch_for(p_ctx jsonb, p_branch uuid, p_need text)
returns maps.branches language plpgsql security definer set search_path = '' as $$
declare v_b maps.branches;
begin
  select * into v_b from maps.branches b where b.id = p_branch and b.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform maps.map_for(p_ctx, v_b.map_id, p_need);
  return v_b;
end $$;

-- Text as kept.
create or replace function maps.clean_title(p text, p_max integer default 120)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) < 1 or char_length(v) > p_max then raise exception 'INVALID:title'; end if;
  return v;
end $$;

create or replace function maps.clean_notes(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := regexp_replace(regexp_replace(coalesce(p, ''), E'\r', '', 'g'), E'^[ \\t\\n]+|[ \\t\\n]+$', '', 'g');
begin
  if char_length(v) > 8000 then raise exception 'INVALID:notes'; end if;
  return v;
end $$;

create or replace function maps.clean_special(p jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare v_out text[] := '{}'; v_item jsonb; v text;
begin
  if p is null or jsonb_typeof(p) = 'null' then return '{}'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'INVALID:special'; end if;
  for v_item in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(v_item) <> 'string' then raise exception 'INVALID:special'; end if;
    v := btrim(regexp_replace(v_item #>> '{}', '\s+', ' ', 'g'));
    if v = '' then continue; end if;
    if char_length(v) > 200 then raise exception 'INVALID:special'; end if;
    v_out := v_out || v;
  end loop;
  if cardinality(v_out) > 20 then raise exception 'INVALID:special'; end if;
  return v_out;
end $$;

-- Typed properties: only the keys the type declares, each value of its kind and in its range. Stored in SI.
create or replace function maps.clean_props(p_type text, p_kind text, p jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_type maps.types; v_out jsonb := '{}'; v_key text; v_val jsonb; v_spec jsonb; v_num numeric;
begin
  select * into v_type from maps.types t where t.id = coalesce(p_type, 'general');
  if not found or not (p_kind = any (v_type.kinds)) then raise exception 'INVALID:type'; end if;
  if p is null or jsonb_typeof(p) = 'null' then return v_out; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'INVALID:props'; end if;
  for v_key, v_val in select * from jsonb_each(p) loop
    if jsonb_typeof(v_val) = 'null' then continue; end if;
    v_spec := v_type.props -> v_key;
    if v_spec is null then raise exception 'INVALID:props'; end if;
    case v_spec ->> 'kind'
      when 'number' then
        if jsonb_typeof(v_val) <> 'number' then raise exception 'INVALID:props'; end if;
        v_num := (v_val #>> '{}')::numeric;
        if (v_spec ? 'min' and v_num < (v_spec ->> 'min')::numeric) or (v_spec ? 'max' and v_num > (v_spec ->> 'max')::numeric) then
          raise exception 'INVALID:props';
        end if;
      when 'enum' then
        if jsonb_typeof(v_val) <> 'string' or not ((v_spec -> 'values') ? (v_val #>> '{}')) then raise exception 'INVALID:props'; end if;
      when 'text' then
        if jsonb_typeof(v_val) <> 'string' or char_length(v_val #>> '{}') > coalesce((v_spec ->> 'max_len')::integer, 80) then
          raise exception 'INVALID:props';
        end if;
        v_val := to_jsonb(btrim(v_val #>> '{}'));
        if v_val #>> '{}' = '' then continue; end if;
      when 'bool' then
        if jsonb_typeof(v_val) <> 'boolean' then raise exception 'INVALID:props'; end if;
      else raise exception 'INVALID:props';
    end case;
    v_out := v_out || jsonb_build_object(v_key, v_val);
  end loop;
  return v_out;
end $$;

-- The 2D place: { x, y } and optionally { w, h }, in drawing units.
create or replace function maps.clean_place(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_out jsonb := '{}'; k text;
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'object' or not (p ? 'x' and p ? 'y') then raise exception 'INVALID:place'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('x', 'y', 'w', 'h') or jsonb_typeof(p -> k) <> 'number' then raise exception 'INVALID:place'; end if;
    if k in ('x', 'y') and abs((p ->> k)::numeric) > 1000000 then raise exception 'INVALID:place'; end if;
    if k in ('w', 'h') and ((p ->> k)::numeric < 1 or (p ->> k)::numeric > 100000) then raise exception 'INVALID:place'; end if;
    v_out := v_out || jsonb_build_object(k, round((p ->> k)::numeric, 1));
  end loop;
  return v_out;
end $$;

-- What a verifier vouches for: the branch's content and the lines it draws (to branches still there).
create or replace function maps.fact(p_branch uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('title', b.title, 'notes', b.notes, 'special', to_jsonb(b.special), 'type', b.type, 'props', b.props,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('to', l.to_id, 'to_title', t.title, 'kind', l.kind, 'rel', l.rel,
                                                             'label', l.label, 'target', l.target, 'props', l.props)
                                         order by l.kind, l.rel, coalesce(t.title, l.target), l.id)
                       from maps.lines l left join maps.branches t on t.id = l.to_id
                       where l.from_id = b.id and (l.to_id is null or t.deleted_at is null)), '[]'::jsonb))
  from maps.branches b where b.id = p_branch;
$$;

-- After a change to a branch (content or its lines): a verifier's change keeps it verified with the new fact;
-- anyone else's leaves the old fact, so the branch shows "changed since verified" with the difference.
create or replace function maps.touched(p_ctx jsonb, p_branch uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (p_ctx ->> 'verifier')::boolean then
    update maps.branches b set verified_fact = maps.fact(b.id), verified_by = (p_ctx ->> 'id')::uuid,
      verified_by_name = p_ctx ->> 'name', verified_at = now()
    where b.id = p_branch and b.verified;
  end if;
end $$;

create or replace function maps.touch_map(p_ctx jsonb, p_map uuid)
returns void language sql security definer set search_path = '' as $$
  update maps.maps set updated_at = now(), updated_by = (p_ctx ->> 'id')::uuid, updated_by_name = p_ctx ->> 'name' where id = p_map;
$$;

create or replace function maps.log(p_ctx jsonb, p_map uuid, p_branch uuid, p_line uuid, p_action text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into maps.history (map_id, branch_id, line_id, action, before, after, by_id, by_name)
  values (p_map, p_branch, p_line, p_action, p_before, p_after, (p_ctx ->> 'id')::uuid, p_ctx ->> 'name');
$$;

-- The branch as history keeps it.
create or replace function maps.snap(p_branch uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('title', b.title, 'notes', b.notes, 'special', to_jsonb(b.special), 'type', b.type, 'props', b.props,
    'place', b.place, 'parent', b.parent_id, 'sort', b.sort)
  from maps.branches b where b.id = p_branch;
$$;

-- Current names (display names) for user ids, with the saved name as fallback. { "<id>": "Name" }
create or replace function maps.names(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_out jsonb := '{}'; v_ids uuid[]; v_part uuid[]; i integer := 1;
begin
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_ids) x where x is not null;
  while i <= coalesce(cardinality(v_ids), 0) loop
    v_part := v_ids[i:i + 499];
    select v_out || coalesce(jsonb_object_agg(d.id::text, d.display_name), '{}') into v_out
    from core.display_names('maps', v_part) d;
    i := i + 500;
  end loop;
  return v_out;
end $$;

-- Trash older than 30 days goes for good. Called when the tile is used (no scheduled job).
create or replace function maps.purge()
returns void language sql security definer set search_path = '' as $$
  delete from maps.maps where deleted_at < now() - interval '30 days';
  delete from maps.branches where deleted_at < now() - interval '30 days';
$$;

-- One branch as the page receives it.
create or replace function maps.branch_json(p_b maps.branches, p_names jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_b.id, 'parent', p_b.parent_id, 'sort', p_b.sort, 'title', p_b.title, 'notes', p_b.notes,
    'special', to_jsonb(p_b.special), 'type', p_b.type, 'props', p_b.props, 'place', p_b.place, 'version', p_b.version,
    'status', case when not p_b.verified then 'to_verify' when p_b.verified_fact is distinct from maps.fact(p_b.id) then 'changed' else 'verified' end,
    'verified_by', case when p_b.verified then coalesce(p_names ->> p_b.verified_by::text, p_b.verified_by_name) end,
    'verified_at', case when p_b.verified then p_b.verified_at end,
    'updated_by', coalesce(p_names ->> p_b.updated_by::text, p_b.updated_by_name), 'updated_at', p_b.updated_at,
    'created_by', coalesce(p_names ->> p_b.created_by::text, p_b.created_by_name), 'created_at', p_b.created_at);
$$;

-- Insert an outline under a branch: [{ depth, title, notes, special: [], type, props: {}, place: {} }], reading order;
-- depth 0 = directly under p_parent, a line at most one level deeper than the one before. Everything comes in
-- "to verify". Checks everything first, then writes. Returns the number added and the first new id.
create or replace function maps.add_items(p_ctx jsonb, p_map maps.maps, p_parent uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_item jsonb; v_depth integer; v_prev integer := -1; v_stack uuid[] := '{}'; v_par uuid; v_id uuid;
  v_first uuid; v_sort integer; v_clean jsonb := '[]'; v_k integer := 0; v_uid uuid := (p_ctx ->> 'id')::uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'INVALID:items'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'INVALID:items'; end if;
  select count(*) into v_n from maps.branches b where b.map_id = p_map.id and b.deleted_at is null;
  if v_n + jsonb_array_length(p_items) > 2000 then raise exception 'INVALID:size'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'INVALID:items'; end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'depth', greatest(coalesce((v_item ->> 'depth')::integer, 0), 0),
      'title', maps.clean_title(v_item ->> 'title'),
      'notes', maps.clean_notes(v_item ->> 'notes'),
      'special', to_jsonb(maps.clean_special(v_item -> 'special')),
      'type', coalesce(v_item ->> 'type', 'general'),
      'props', maps.clean_props(coalesce(v_item ->> 'type', 'general'), p_map.kind, v_item -> 'props'),
      'place', maps.clean_place(v_item -> 'place')));
  end loop;
  for v_item in select * from jsonb_array_elements(v_clean) loop
    v_depth := least((v_item ->> 'depth')::integer, v_prev + 1);
    v_par := case when v_depth = 0 then p_parent else v_stack[v_depth] end;
    select coalesce(max(b.sort) + 1, 0) into v_sort from maps.branches b where b.parent_id = v_par and b.deleted_at is null;
    insert into maps.branches (map_id, parent_id, sort, title, notes, special, type, props, place, verified,
      created_by, created_by_name, created_at, updated_by, updated_by_name, updated_at)
    values (p_map.id, v_par, v_sort, v_item ->> 'title', v_item ->> 'notes',
      array(select jsonb_array_elements_text(v_item -> 'special')), v_item ->> 'type', v_item -> 'props',
      case when jsonb_typeof(v_item -> 'place') = 'object' then v_item -> 'place' end, false,
      v_uid, p_ctx ->> 'name', now() + v_k * interval '1 microsecond', v_uid, p_ctx ->> 'name', now())
    returning id into v_id;
    v_stack := v_stack[1:v_depth] || v_id;
    v_prev := v_depth; v_k := v_k + 1;
    if v_first is null then v_first := v_id; end if;
  end loop;
  return jsonb_build_object('added', v_k, 'first', v_first);
end $$;

-- Nothing in schema maps is callable by the browser roles.
revoke execute on all functions in schema maps from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Functions the pages call (public.maps_*)
-- ---------------------------------------------------------------------------

-- The branch types and their properties, for the forms.
create or replace function public.maps_types()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform core.require_tile('maps', null);
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kinds', to_jsonb(t.kinds), 'props', t.props) order by t.sort, t.id)
                   from maps.types t), '[]'::jsonb);
end $$;
revoke execute on function public.maps_types() from public, anon;
grant execute on function public.maps_types() to authenticated;

-- Every map the caller may open, latest change first, with what it holds and what he may do.
create or replace function public.maps_list()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_maps jsonb; v_names jsonb;
begin
  v_ctx := maps.ctx(); v_uid := (v_ctx ->> 'id')::uuid;
  perform maps.purge();
  select maps.names(array_agg(m.owner_id) || array_agg(m.updated_by)) into v_names
  from maps.maps m where m.deleted_at is null and (m.owner_id = v_uid or m.share <> 'private');
  select coalesce(jsonb_agg(x.j order by x.updated_at desc, x.id), '[]') into v_maps from (
    select m.id, m.updated_at, jsonb_build_object('id', m.id, 'name', m.name, 'kind', m.kind, 'share', m.share,
      'mine', m.owner_id = v_uid, 'owner', coalesce(v_names ->> m.owner_id::text, m.owner_name),
      'right', maps.right_on(v_ctx, m), 'updated_at', m.updated_at,
      'updated_by', coalesce(v_names ->> m.updated_by::text, m.updated_by_name),
      'branches', (select count(*) from maps.branches b where b.map_id = m.id and b.deleted_at is null and b.parent_id is not null),
      'to_verify', (select count(*) from maps.branches b where b.map_id = m.id and b.deleted_at is null and b.parent_id is not null
                      and (not b.verified or b.verified_fact is distinct from maps.fact(b.id)))) j
    from maps.maps m
    where m.deleted_at is null and maps.right_on(v_ctx, m) <> 'none'
  ) x;
  return jsonb_build_object('maps', v_maps,
    'me', jsonb_build_object('editor', (v_ctx ->> 'editor')::boolean, 'verifier', (v_ctx ->> 'verifier')::boolean,
                             'admin', (v_ctx ->> 'admin')::boolean));
end $$;
revoke execute on function public.maps_list() from public, anon;
grant execute on function public.maps_list() to authenticated;

-- Words in every map the caller may open: branch names first, then special notes, then notes. At most 60 branches.
create or replace function public.maps_search(p_q text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_q text := lower(btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g'))); v_pat text;
begin
  v_ctx := maps.ctx();
  if char_length(v_q) < 2 then return '[]'::jsonb; end if;
  if char_length(v_q) > 100 then raise exception 'INVALID:q'; end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
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
      where b.deleted_at is null and m.deleted_at is null and maps.right_on(v_ctx, m) <> 'none'
        and (lower(b.title) like v_pat escape '\' or lower(b.notes) like v_pat escape '\'
             or lower(array_to_string(b.special, E'\n')) like v_pat escape '\')
      order by 7, m.name, b.title limit 60
    ) x
  ) h), '[]'::jsonb);
end $$;
revoke execute on function public.maps_search(text) from public, anon;
grant execute on function public.maps_search(text) to authenticated;

-- A new map (right 'edit'). The centre branch carries the map's name. p_items: a starter template, added the same way
-- as Import (everything in it "to verify"). Step 1 makes knowledge maps only.
create or replace function public.maps_create(p_name text, p_kind text, p_share text, p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_name text; v_map maps.maps; v_root uuid; v_n integer; v_add jsonb;
begin
  v_ctx := maps.ctx('edit'); v_uid := (v_ctx ->> 'id')::uuid;
  v_name := maps.clean_title(p_name, 80);
  if coalesce(p_kind, 'knowledge') <> 'knowledge' then raise exception 'INVALID:kind'; end if;
  if coalesce(p_share, 'private') not in ('private', 'team_read', 'team_edit') then raise exception 'INVALID:share'; end if;
  if exists (select 1 from maps.maps m where m.owner_id = v_uid and m.deleted_at is null and lower(m.name) = lower(v_name)) then
    raise exception 'INVALID:name_taken';
  end if;
  select count(*) into v_n from maps.maps m where m.owner_id = v_uid and m.deleted_at is null;
  if v_n >= 200 then raise exception 'INVALID:too_many'; end if;
  insert into maps.maps (name, kind, share, owner_id, owner_name, updated_by, updated_by_name)
  values (v_name, coalesce(p_kind, 'knowledge'), coalesce(p_share, 'private'), v_uid, v_ctx ->> 'name', v_uid, v_ctx ->> 'name')
  returning * into v_map;
  insert into maps.branches (map_id, parent_id, title, verified, verified_by, verified_by_name, verified_at, created_by, created_by_name, updated_by, updated_by_name)
  values (v_map.id, null, v_name, true, v_uid, v_ctx ->> 'name', now(), v_uid, v_ctx ->> 'name', v_uid, v_ctx ->> 'name')
  returning id into v_root;
  update maps.branches set verified_fact = maps.fact(id) where id = v_root;
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    v_add := maps.add_items(v_ctx, v_map, v_root, p_items);
  end if;
  perform maps.log(v_ctx, v_map.id, null, null, 'map_create', null,
    jsonb_build_object('name', v_map.name, 'kind', v_map.kind, 'share', v_map.share, 'starter', coalesce((v_add ->> 'added')::integer, 0)));
  perform core.audit('maps', 'map_create', jsonb_build_object('map', v_map.id, 'share', v_map.share));
  return jsonb_build_object('id', v_map.id);
end $$;
revoke execute on function public.maps_create(text, text, text, jsonb) from public, anon;
grant execute on function public.maps_create(text, text, text, jsonb) to authenticated;

-- One map with its branches and lines. Lines to or from a map the caller may not open are left out.
create or replace function public.maps_get(p_map uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_map maps.maps; v_names jsonb; v_branches jsonb; v_lines jsonb; v_changed jsonb; v_right text;
begin
  v_ctx := maps.ctx(); v_uid := (v_ctx ->> 'id')::uuid;
  v_map := maps.map_for(v_ctx, p_map, 'read');
  v_right := maps.right_on(v_ctx, v_map);
  select maps.names(array[v_map.owner_id, v_map.updated_by] || coalesce(array_agg(b.updated_by), '{}') || coalesce(array_agg(b.verified_by), '{}')
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
    and maps.right_on(v_ctx, fm) <> 'none' and (tm.id is null or maps.right_on(v_ctx, tm) <> 'none');
  return jsonb_build_object(
    'map', jsonb_build_object('id', v_map.id, 'name', v_map.name, 'kind', v_map.kind, 'share', v_map.share, 'version', v_map.version,
      'mine', v_map.owner_id = v_uid, 'owner', coalesce(v_names ->> v_map.owner_id::text, v_map.owner_name), 'right', v_right,
      'can_verify', (v_ctx ->> 'verifier')::boolean, 'updated_at', v_map.updated_at,
      'updated_by', coalesce(v_names ->> v_map.updated_by::text, v_map.updated_by_name)),
    'branches', v_branches, 'lines', v_lines, 'verified_facts', v_changed);
end $$;
revoke execute on function public.maps_get(uuid) from public, anon;
grant execute on function public.maps_get(uuid) to authenticated;

-- Map settings (whoever manages the map): name, who it is shared with. A null leaves that part as it is.
create or replace function public.maps_map_save(p_map uuid, p_version integer, p_name text, p_share text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_map maps.maps; v_name text; v_share text;
begin
  v_ctx := maps.ctx();
  v_map := maps.map_for(v_ctx, p_map, 'manage');
  if p_version is distinct from v_map.version then
    raise exception 'INVALID:version' using detail = jsonb_build_object('by', v_map.updated_by_name, 'at', v_map.updated_at)::text;
  end if;
  v_name := case when p_name is null then v_map.name else maps.clean_title(p_name, 80) end;
  v_share := coalesce(p_share, v_map.share);
  if v_share not in ('private', 'team_read', 'team_edit') then raise exception 'INVALID:share'; end if;
  -- a shared map made private stays with its owner only: only he may do that
  if v_share = 'private' and v_map.share <> 'private' and v_map.owner_id <> (v_ctx ->> 'id')::uuid then raise exception 'NO_RIGHT'; end if;
  if lower(v_name) <> lower(v_map.name) and exists (select 1 from maps.maps m where m.owner_id = v_map.owner_id and m.deleted_at is null
       and lower(m.name) = lower(v_name) and m.id <> v_map.id) then
    raise exception 'INVALID:name_taken';
  end if;
  if v_name = v_map.name and v_share = v_map.share then return jsonb_build_object('version', v_map.version); end if;
  update maps.maps set name = v_name, share = v_share, version = version + 1, updated_at = now(),
    updated_by = (v_ctx ->> 'id')::uuid, updated_by_name = v_ctx ->> 'name' where id = v_map.id;
  if v_name <> v_map.name then
    update maps.branches set title = v_name, version = version + 1, updated_at = now(),
      updated_by = (v_ctx ->> 'id')::uuid, updated_by_name = v_ctx ->> 'name'
    where map_id = v_map.id and parent_id is null;
  end if;
  perform maps.log(v_ctx, v_map.id, null, null, 'map_settings', jsonb_build_object('name', v_map.name, 'share', v_map.share),
    jsonb_build_object('name', v_name, 'share', v_share));
  if v_share <> v_map.share then perform core.audit('maps', 'map_share', jsonb_build_object('map', v_map.id, 'from', v_map.share, 'to', v_share)); end if;
  return jsonb_build_object('version', v_map.version + 1);
end $$;
revoke execute on function public.maps_map_save(uuid, integer, text, text) from public, anon;
grant execute on function public.maps_map_save(uuid, integer, text, text) to authenticated;

-- A map to the trash (whoever manages it). Restorable for 30 days.
create or replace function public.maps_map_delete(p_map uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_map maps.maps;
begin
  v_ctx := maps.ctx();
  v_map := maps.map_for(v_ctx, p_map, 'manage');
  update maps.maps set deleted_at = now(), deleted_by = (v_ctx ->> 'id')::uuid, deleted_by_name = v_ctx ->> 'name' where id = v_map.id;
  perform maps.log(v_ctx, v_map.id, null, null, 'map_delete', jsonb_build_object('name', v_map.name), null);
  perform core.audit('maps', 'map_delete', jsonb_build_object('map', v_map.id, 'name', v_map.name));
end $$;
revoke execute on function public.maps_map_delete(uuid) from public, anon;
grant execute on function public.maps_map_delete(uuid) to authenticated;

-- A new branch under p_parent, last among its branches. A verifier's own branch starts verified.
create or replace function public.maps_branch_add(p_parent uuid, p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_par maps.branches; v_map maps.maps; v_n integer; v_b maps.branches; v_ver boolean;
begin
  v_ctx := maps.ctx(); v_uid := (v_ctx ->> 'id')::uuid;
  v_par := maps.branch_for(v_ctx, p_parent, 'edit');
  select * into v_map from maps.maps m where m.id = v_par.map_id;
  select count(*) into v_n from maps.branches b where b.map_id = v_map.id and b.deleted_at is null;
  if v_n >= 2000 then raise exception 'INVALID:size'; end if;
  v_ver := (v_ctx ->> 'verifier')::boolean;
  insert into maps.branches (map_id, parent_id, sort, title, verified, verified_by, verified_by_name, verified_at,
    created_by, created_by_name, updated_by, updated_by_name)
  values (v_map.id, v_par.id, (select coalesce(max(b.sort) + 1, 0) from maps.branches b where b.parent_id = v_par.id and b.deleted_at is null),
    maps.clean_title(p_title), v_ver, case when v_ver then v_uid end, case when v_ver then v_ctx ->> 'name' end, case when v_ver then now() end,
    v_uid, v_ctx ->> 'name', v_uid, v_ctx ->> 'name')
  returning * into v_b;
  if v_ver then update maps.branches set verified_fact = maps.fact(id) where id = v_b.id returning * into v_b; end if;
  perform maps.touch_map(v_ctx, v_map.id);
  perform maps.log(v_ctx, v_map.id, v_b.id, null, 'branch_add', null, maps.snap(v_b.id));
  return maps.branch_json(v_b, '{}'::jsonb);
end $$;
revoke execute on function public.maps_branch_add(uuid, text) from public, anon;
grant execute on function public.maps_branch_add(uuid, text) to authenticated;

-- Change a branch. p_patch holds only what changed: { title, notes, special: [...], type, props: {...}, place: {...} }.
-- p_version: the version the page read; a newer one is refused (INVALID:version, detail: who and when).
-- Renaming the centre renames the map (whoever manages it).
create or replace function public.maps_branch_save(p_branch uuid, p_version integer, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_b maps.branches; v_map maps.maps; v_new maps.branches; v_before jsonb; v_last maps.history;
  v_type text; v_names jsonb;
begin
  v_ctx := maps.ctx(); v_uid := (v_ctx ->> 'id')::uuid;
  v_b := maps.branch_for(v_ctx, p_branch, 'edit');
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'INVALID:patch'; end if;
  if p_version is distinct from v_b.version then
    raise exception 'INVALID:version' using detail = jsonb_build_object('by', v_b.updated_by_name, 'at', v_b.updated_at)::text;
  end if;
  select * into v_map from maps.maps m where m.id = v_b.map_id;
  v_new := v_b;
  if p_patch ? 'title' then v_new.title := maps.clean_title(p_patch ->> 'title', case when v_b.parent_id is null then 80 else 120 end); end if;
  if p_patch ? 'notes' then v_new.notes := maps.clean_notes(p_patch ->> 'notes'); end if;
  if p_patch ? 'special' then v_new.special := maps.clean_special(p_patch -> 'special'); end if;
  v_type := coalesce(p_patch ->> 'type', v_b.type);
  if p_patch ? 'type' or p_patch ? 'props' then
    v_new.type := v_type;
    v_new.props := maps.clean_props(v_type, v_map.kind, case when p_patch ? 'props' then p_patch -> 'props' else v_b.props end);
  end if;
  if p_patch ? 'place' then v_new.place := maps.clean_place(p_patch -> 'place'); end if;
  if v_new.title = v_b.title and v_new.notes = v_b.notes and v_new.special = v_b.special and v_new.type = v_b.type
     and v_new.props = v_b.props and v_new.place is not distinct from v_b.place then
    return maps.branch_json(v_b, '{}'::jsonb);
  end if;
  -- the centre is the map's name
  if v_b.parent_id is null and v_new.title <> v_b.title then
    perform maps.map_for(v_ctx, v_map.id, 'manage');
    if lower(v_new.title) <> lower(v_map.name) and exists (select 1 from maps.maps m where m.owner_id = v_map.owner_id
         and m.deleted_at is null and lower(m.name) = lower(v_new.title) and m.id <> v_map.id) then
      raise exception 'INVALID:name_taken';
    end if;
    update maps.maps set name = v_new.title, version = version + 1 where id = v_map.id;
  end if;
  v_before := maps.snap(v_b.id);
  update maps.branches set title = v_new.title, notes = v_new.notes, special = v_new.special, type = v_new.type, props = v_new.props,
    place = v_new.place, version = version + 1, updated_by = v_uid, updated_by_name = v_ctx ->> 'name', updated_at = now()
  where id = v_b.id;
  perform maps.touched(v_ctx, v_b.id);
  perform maps.touch_map(v_ctx, v_map.id);
  -- typing in one branch for a while is one history entry: the same person within 10 minutes extends it
  select * into v_last from maps.history h where h.branch_id = v_b.id order by h.id desc limit 1;
  if found and v_last.action = 'branch_edit' and v_last.by_id = v_uid and v_last.at > now() - interval '10 minutes' then
    update maps.history set after = maps.snap(v_b.id), at = now() where id = v_last.id;
  else
    perform maps.log(v_ctx, v_map.id, v_b.id, null, 'branch_edit', v_before, maps.snap(v_b.id));
  end if;
  select * into v_new from maps.branches b where b.id = v_b.id;
  v_names := maps.names(array[v_new.verified_by, v_new.created_by]);
  return maps.branch_json(v_new, v_names);
end $$;
revoke execute on function public.maps_branch_save(uuid, integer, jsonb) from public, anon;
grant execute on function public.maps_branch_save(uuid, integer, jsonb) to authenticated;

-- Move a branch: under p_parent (same map, not inside itself) at position p_index among its branches.
-- Returns the new order of the branches there.
create or replace function public.maps_branch_move(p_branch uuid, p_parent uuid, p_index integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_b maps.branches; v_par maps.branches; v_ids uuid[]; v_i integer;
begin
  v_ctx := maps.ctx();
  v_b := maps.branch_for(v_ctx, p_branch, 'edit');
  if v_b.parent_id is null then raise exception 'INVALID:branch'; end if;
  select * into v_par from maps.branches b where b.id = coalesce(p_parent, v_b.parent_id) and b.deleted_at is null and b.map_id = v_b.map_id;
  if not found then raise exception 'INVALID:parent'; end if;
  if exists (with recursive t(id) as (select v_b.id union all select c.id from maps.branches c join t on c.parent_id = t.id)
             select 1 from t where t.id = v_par.id) then
    raise exception 'INVALID:parent';
  end if;
  select coalesce(array_agg(b.id order by b.sort, b.created_at, b.id), '{}') into v_ids
  from maps.branches b where b.parent_id = v_par.id and b.deleted_at is null and b.id <> v_b.id;
  v_i := greatest(0, least(coalesce(p_index, cardinality(v_ids)), cardinality(v_ids)));
  v_ids := v_ids[1:v_i] || v_b.id || v_ids[v_i + 1:];
  update maps.branches b set sort = x.k - 1, parent_id = v_par.id
  from unnest(v_ids) with ordinality x(id, k) where b.id = x.id;
  perform maps.touch_map(v_ctx, v_b.map_id);
  perform maps.log(v_ctx, v_b.map_id, v_b.id, null, 'branch_move', jsonb_build_object('parent', v_b.parent_id, 'sort', v_b.sort),
    jsonb_build_object('parent', v_par.id, 'sort', v_i));
  return jsonb_build_object('parent', v_par.id, 'order', to_jsonb(v_ids));
end $$;
revoke execute on function public.maps_branch_move(uuid, uuid, integer) from public, anon;
grant execute on function public.maps_branch_move(uuid, uuid, integer) to authenticated;

-- A branch and everything under it to the trash (edit right on the map). The centre goes only with its map.
create or replace function public.maps_branch_delete(p_branch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_b maps.branches; v_n integer;
begin
  v_ctx := maps.ctx();
  v_b := maps.branch_for(v_ctx, p_branch, 'edit');
  if v_b.parent_id is null then raise exception 'INVALID:branch'; end if;
  with recursive t(id) as (select v_b.id union all select c.id from maps.branches c join t on c.parent_id = t.id where c.deleted_at is null)
  update maps.branches b set deleted_at = now(), deleted_by = (v_ctx ->> 'id')::uuid, deleted_by_name = v_ctx ->> 'name', trash_root = v_b.id
  from t where b.id = t.id;
  get diagnostics v_n = row_count;
  perform maps.touch_map(v_ctx, v_b.map_id);
  perform maps.log(v_ctx, v_b.map_id, v_b.id, null, 'branch_delete', maps.snap(v_b.id) || jsonb_build_object('with', v_n - 1), null);
  return jsonb_build_object('deleted', v_n);
end $$;
revoke execute on function public.maps_branch_delete(uuid) from public, anon;
grant execute on function public.maps_branch_delete(uuid) to authenticated;

-- Verify (right 'verify', any map the verifier may open) or mark "to verify" (verifier or editor of the map).
-- p_deep: the branch and everything under it.
create or replace function public.maps_verify(p_branch uuid, p_on boolean, p_deep boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_b maps.branches; v_ids uuid[]; v_n integer := 0; v_id uuid;
begin
  v_ctx := maps.ctx(); v_uid := (v_ctx ->> 'id')::uuid;
  v_b := maps.branch_for(v_ctx, p_branch, case when coalesce(p_on, true) or (v_ctx ->> 'verifier')::boolean then 'read' else 'edit' end);
  if coalesce(p_on, true) and not (v_ctx ->> 'verifier')::boolean then raise exception 'NO_RIGHT'; end if;
  if coalesce(p_deep, false) then
    with recursive t(id) as (select v_b.id union all select c.id from maps.branches c join t on c.parent_id = t.id where c.deleted_at is null)
    select array_agg(id) into v_ids from t;
  else v_ids := array[v_b.id]; end if;
  foreach v_id in array v_ids loop
    if coalesce(p_on, true) then
      update maps.branches b set verified = true, verified_by = v_uid, verified_by_name = v_ctx ->> 'name', verified_at = now(),
        verified_fact = maps.fact(b.id)
      where b.id = v_id and (not b.verified or b.verified_fact is distinct from maps.fact(b.id));
    else
      update maps.branches b set verified = false, verified_by = null, verified_by_name = null, verified_at = null, verified_fact = null
      where b.id = v_id and b.verified;
    end if;
    if found then v_n := v_n + 1; end if;
  end loop;
  if v_n > 0 then
    perform maps.touch_map(v_ctx, v_b.map_id);
    perform maps.log(v_ctx, v_b.map_id, v_b.id, null, case when coalesce(p_on, true) then 'verify' else 'unverify' end, null,
      jsonb_build_object('branches', v_n, 'deep', coalesce(p_deep, false)));
  end if;
  return jsonb_build_object('changed', v_n);
end $$;
revoke execute on function public.maps_verify(uuid, boolean, boolean) from public, anon;
grant execute on function public.maps_verify(uuid, boolean, boolean) to authenticated;

-- A line from a branch: p_kind 'link' (to another branch, p_rel = what it means) or 'web' (p_target an https address).
-- The "to" branch may be in another map the caller may open. Pipes, wires and tile links come in later steps.
create or replace function public.maps_line_add(p_from uuid, p_kind text, p_rel text, p_to uuid, p_target text, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_from maps.branches; v_to maps.branches; v_rel text; v_target text; v_id uuid; v_n integer;
begin
  v_ctx := maps.ctx(); v_uid := (v_ctx ->> 'id')::uuid;
  v_from := maps.branch_for(v_ctx, p_from, 'edit');
  select count(*) into v_n from maps.lines l where l.from_id = v_from.id;
  if v_n >= 20 then raise exception 'INVALID:lines'; end if;
  if char_length(btrim(coalesce(p_label, ''))) > 120 then raise exception 'INVALID:label'; end if;
  if p_kind = 'link' then
    v_rel := coalesce(nullif(p_rel, ''), 'see');
    if v_rel not in ('requires', 'equivalent', 'excludes', 'replaced', 'part', 'see') then raise exception 'INVALID:rel'; end if;
    if p_to is null or p_to = v_from.id then raise exception 'INVALID:to'; end if;
    v_to := maps.branch_for(v_ctx, p_to, 'read');
    if exists (select 1 from maps.lines l where l.from_id = v_from.id and l.to_id = v_to.id and l.rel = v_rel) then raise exception 'INVALID:duplicate'; end if;
  elsif p_kind = 'web' then
    v_rel := 'web';
    v_target := btrim(coalesce(p_target, ''));
    if v_target !~ '^https://[^\s<>"'']+$' or char_length(v_target) < 12 or char_length(v_target) > 500 then raise exception 'INVALID:target'; end if;
  else
    raise exception 'INVALID:kind';
  end if;
  insert into maps.lines (map_id, from_id, to_id, kind, rel, label, target, sort, created_by, created_by_name, updated_by, updated_by_name)
  values (v_from.map_id, v_from.id, v_to.id, p_kind, v_rel, btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g')), v_target,
    (select coalesce(max(l.sort) + 1, 0) from maps.lines l where l.from_id = v_from.id), v_uid, v_ctx ->> 'name', v_uid, v_ctx ->> 'name')
  returning id into v_id;
  perform maps.touched(v_ctx, v_from.id);
  perform maps.touch_map(v_ctx, v_from.map_id);
  perform maps.log(v_ctx, v_from.map_id, v_from.id, v_id, 'line_add', null,
    jsonb_build_object('kind', p_kind, 'rel', v_rel, 'to', v_to.id, 'to_title', v_to.title, 'target', v_target));
  return jsonb_build_object('id', v_id, 'version', 1);
end $$;
revoke execute on function public.maps_line_add(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.maps_line_add(uuid, text, text, uuid, text, text) to authenticated;

-- Change what a line means or its text (edit right on the map it starts in). p_version as for branches.
create or replace function public.maps_line_save(p_line uuid, p_version integer, p_rel text, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_l maps.lines; v_rel text; v_label text;
begin
  v_ctx := maps.ctx();
  select * into v_l from maps.lines l where l.id = p_line;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform maps.branch_for(v_ctx, v_l.from_id, 'edit');
  if p_version is distinct from v_l.version then
    raise exception 'INVALID:version' using detail = jsonb_build_object('by', v_l.updated_by_name, 'at', v_l.updated_at)::text;
  end if;
  v_rel := coalesce(nullif(p_rel, ''), v_l.rel);
  if v_l.kind = 'link' and v_rel not in ('requires', 'equivalent', 'excludes', 'replaced', 'part', 'see') then raise exception 'INVALID:rel'; end if;
  if v_l.kind = 'web' and v_rel <> 'web' then raise exception 'INVALID:rel'; end if;
  v_label := btrim(regexp_replace(coalesce(p_label, v_l.label), '\s+', ' ', 'g'));
  if char_length(v_label) > 120 then raise exception 'INVALID:label'; end if;
  if v_rel = v_l.rel and v_label = v_l.label then return jsonb_build_object('id', v_l.id, 'version', v_l.version); end if;
  update maps.lines set rel = v_rel, label = v_label, version = version + 1, updated_at = now(),
    updated_by = (v_ctx ->> 'id')::uuid, updated_by_name = v_ctx ->> 'name' where id = v_l.id;
  perform maps.touched(v_ctx, v_l.from_id);
  perform maps.touch_map(v_ctx, v_l.map_id);
  perform maps.log(v_ctx, v_l.map_id, v_l.from_id, v_l.id, 'line_edit', jsonb_build_object('rel', v_l.rel, 'label', v_l.label),
    jsonb_build_object('rel', v_rel, 'label', v_label));
  return jsonb_build_object('id', v_l.id, 'version', v_l.version + 1);
end $$;
revoke execute on function public.maps_line_save(uuid, integer, text, text) from public, anon;
grant execute on function public.maps_line_save(uuid, integer, text, text) to authenticated;

create or replace function public.maps_line_delete(p_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_l maps.lines;
begin
  v_ctx := maps.ctx();
  select * into v_l from maps.lines l where l.id = p_line;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform maps.branch_for(v_ctx, v_l.from_id, 'edit');
  delete from maps.lines where id = v_l.id;
  perform maps.touched(v_ctx, v_l.from_id);
  perform maps.touch_map(v_ctx, v_l.map_id);
  perform maps.log(v_ctx, v_l.map_id, v_l.from_id, v_l.id, 'line_delete',
    jsonb_build_object('kind', v_l.kind, 'rel', v_l.rel, 'to', v_l.to_id, 'target', v_l.target, 'label', v_l.label), null);
end $$;
revoke execute on function public.maps_line_delete(uuid) from public, anon;
grant execute on function public.maps_line_delete(uuid) to authenticated;

-- Import an outline under a branch (right 'edit' and edit on the map). Up to 500 branches, all "to verify".
create or replace function public.maps_import(p_parent uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_par maps.branches; v_map maps.maps; v_res jsonb;
begin
  v_ctx := maps.ctx('edit');
  v_par := maps.branch_for(v_ctx, p_parent, 'edit');
  select * into v_map from maps.maps m where m.id = v_par.map_id;
  v_res := maps.add_items(v_ctx, v_map, v_par.id, p_items);
  perform maps.touch_map(v_ctx, v_map.id);
  perform maps.log(v_ctx, v_map.id, v_par.id, null, 'import', null, v_res);
  perform core.audit('maps', 'import', jsonb_build_object('map', v_map.id, 'added', v_res -> 'added'));
  return v_res;
end $$;
revoke execute on function public.maps_import(uuid, jsonb) from public, anon;
grant execute on function public.maps_import(uuid, jsonb) to authenticated;

-- What changed in a map (or in one branch), newest first, 50 at a time (p_before: the last id seen).
create or replace function public.maps_history(p_map uuid, p_branch uuid default null, p_before bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_map maps.maps; v_names jsonb;
begin
  v_ctx := maps.ctx();
  v_map := maps.map_for(v_ctx, p_map, 'read');
  select maps.names(array_agg(h.by_id)) into v_names from (
    select h.by_id from maps.history h where h.map_id = v_map.id and (p_branch is null or h.branch_id = p_branch)
      and (p_before is null or h.id < p_before) order by h.id desc limit 50) h;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'branch', h.branch_id, 'line', h.line_id, 'action', h.action,
      'before', h.before, 'after', h.after, 'by', coalesce(v_names ->> h.by_id::text, h.by_name), 'at', h.at,
      'title', coalesce(b.title, h.after ->> 'title', h.before ->> 'title'), 'gone', b.id is null or b.deleted_at is not null) order by h.id desc)
    from (select * from maps.history h where h.map_id = v_map.id and (p_branch is null or h.branch_id = p_branch)
            and (p_before is null or h.id < p_before) order by h.id desc limit 50) h
    left join maps.branches b on b.id = h.branch_id), '[]'::jsonb);
end $$;
revoke execute on function public.maps_history(uuid, uuid, bigint) from public, anon;
grant execute on function public.maps_history(uuid, uuid, bigint) to authenticated;

-- The trash the caller may restore from: deleted maps he manages, and deleted branches of live maps he manages
-- (p_map: one map only). Purges what is older than 30 days first.
create or replace function public.maps_trash(p_map uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_maps jsonb; v_branches jsonb;
begin
  v_ctx := maps.ctx();
  perform maps.purge();
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'deleted_at', m.deleted_at, 'deleted_by', m.deleted_by_name,
      'until', m.deleted_at + interval '30 days',
      'branches', (select count(*) from maps.branches b where b.map_id = m.id and b.deleted_at is null and b.parent_id is not null))
      order by m.deleted_at desc), '[]') into v_maps
  from maps.maps m where m.deleted_at is not null and maps.right_on(v_ctx, m) = 'manage' and (p_map is null or m.id = p_map);
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'map_id', m.id, 'map', m.name, 'title', b.title, 'parent_title', p.title,
      'parent_gone', p.deleted_at is not null, 'deleted_at', b.deleted_at, 'deleted_by', b.deleted_by_name,
      'until', b.deleted_at + interval '30 days',
      'with', (select count(*) - 1 from maps.branches x where x.trash_root = b.id and x.deleted_at = b.deleted_at))
      order by b.deleted_at desc), '[]') into v_branches
  from maps.branches b join maps.maps m on m.id = b.map_id left join maps.branches p on p.id = b.parent_id
  where b.deleted_at is not null and b.trash_root = b.id and m.deleted_at is null
    and maps.right_on(v_ctx, m) = 'manage' and (p_map is null or m.id = p_map);
  return jsonb_build_object('maps', v_maps, 'branches', v_branches);
end $$;
revoke execute on function public.maps_trash(uuid) from public, anon;
grant execute on function public.maps_trash(uuid) to authenticated;

-- Restore a map from the trash (whoever manages it). If its owner has made a map of the same name meanwhile, it comes
-- back as "<name> (restored)".
create or replace function public.maps_map_restore(p_map uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_map maps.maps; v_name text;
begin
  v_ctx := maps.ctx();
  perform maps.purge();
  select * into v_map from maps.maps m where m.id = p_map and m.deleted_at is not null;
  if not found or maps.right_on(v_ctx, v_map) = 'none' then raise exception 'NOT_FOUND'; end if;
  if maps.right_on(v_ctx, v_map) <> 'manage' then raise exception 'NO_RIGHT'; end if;
  v_name := v_map.name;
  if exists (select 1 from maps.maps m where m.owner_id = v_map.owner_id and m.deleted_at is null and lower(m.name) = lower(v_name)) then
    v_name := left(v_map.name, 69) || ' (restored)';
    if exists (select 1 from maps.maps m where m.owner_id = v_map.owner_id and m.deleted_at is null and lower(m.name) = lower(v_name)) then
      raise exception 'INVALID:name_taken';
    end if;
    update maps.branches set title = v_name where map_id = v_map.id and parent_id is null;
  end if;
  update maps.maps set deleted_at = null, deleted_by = null, deleted_by_name = null, name = v_name, version = version + 1,
    updated_at = now(), updated_by = (v_ctx ->> 'id')::uuid, updated_by_name = v_ctx ->> 'name' where id = v_map.id;
  perform maps.log(v_ctx, v_map.id, null, null, 'map_restore', null, jsonb_build_object('name', v_name));
  perform core.audit('maps', 'map_restore', jsonb_build_object('map', v_map.id));
  return jsonb_build_object('id', v_map.id, 'name', v_name);
end $$;
revoke execute on function public.maps_map_restore(uuid) from public, anon;
grant execute on function public.maps_map_restore(uuid) to authenticated;

-- Restore a deleted branch and what went with it (whoever manages the map). Its parent must be there (INVALID:parent).
create or replace function public.maps_branch_restore(p_branch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_b maps.branches; v_n integer; v_live integer;
begin
  v_ctx := maps.ctx();
  perform maps.purge();
  select * into v_b from maps.branches b where b.id = p_branch and b.deleted_at is not null and b.trash_root = b.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform maps.map_for(v_ctx, v_b.map_id, 'manage');
  if exists (select 1 from maps.branches p where p.id = v_b.parent_id and p.deleted_at is not null) then raise exception 'INVALID:parent'; end if;
  select count(*) into v_n from maps.branches b where b.trash_root = v_b.id and b.deleted_at = v_b.deleted_at;
  select count(*) into v_live from maps.branches b where b.map_id = v_b.map_id and b.deleted_at is null;
  if v_live + v_n > 2000 then raise exception 'INVALID:size'; end if;
  update maps.branches b set deleted_at = null, deleted_by = null, deleted_by_name = null, trash_root = null
  where b.trash_root = v_b.id and b.deleted_at = v_b.deleted_at;
  update maps.branches b set sort = (select coalesce(max(s.sort) + 1, 0) from maps.branches s where s.parent_id = v_b.parent_id
    and s.deleted_at is null and s.id <> v_b.id) where b.id = v_b.id;
  perform maps.touch_map(v_ctx, v_b.map_id);
  perform maps.log(v_ctx, v_b.map_id, v_b.id, null, 'branch_restore', null, maps.snap(v_b.id) || jsonb_build_object('with', v_n - 1));
  return jsonb_build_object('id', v_b.id, 'map_id', v_b.map_id, 'restored', v_n);
end $$;
revoke execute on function public.maps_branch_restore(uuid) from public, anon;
grant execute on function public.maps_branch_restore(uuid) to authenticated;

select core.applied('maps', '001_init');
