-- Maps tile, step 3: flowcharts (and links to other tiles, from step 2).
-- Touches only: schema maps, functions public.maps_*. No new table, no grant to anon or public.
-- Needs db/maps/001_init.sql and 002_flowchart_ready.sql. Read it, then paste it whole in the SQL editor.
-- Then: select * from core.security_check();  (no rows)
--
-- What it does:
--   1. Typed properties may be a list of short texts (kind 'list'). The centre branch of a flowchart keeps its lanes
--      (swimlanes, in order) as 'lanes' on type 'general'.
--   2. maps_create makes knowledge and flowchart maps.
--   3. In a flowchart every step sits directly under the centre: maps_branch_add makes a Process step there,
--      maps_branch_move and Import keep steps there (INVALID:parent otherwise).
--   4. maps_line_add / maps_line_save know two more kinds:
--        'flow' - an arrow from one step to the next in the same flowchart; its label is the answer (Yes, No ...),
--                 up to 40 characters; one arrow per pair of steps; never from or to the centre.
--        'tile' - a link to a page of another tile: target '<tile-id>' or '<tile-id>/<path>', opened at /<tile-id>/...
--                 (never a full address, so it survives a move of the site).
--   5. Import (and starters) may bring arrows: each item may carry a 'key' and 'next': [{ to: <key>, label }].
--   Calculations (layout, checks, paths) stay in the browser.

-- ---------------------------------------------------------------------------
-- 1. Typed properties: kind 'list'
-- ---------------------------------------------------------------------------
create or replace function maps.clean_props(p_type text, p_kind text, p jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_type maps.types; v_out jsonb := '{}'; v_key text; v_val jsonb; v_spec jsonb; v_num numeric; v_item jsonb; v_list jsonb; v_t text;
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
        v_val := to_jsonb(btrim(regexp_replace(v_val #>> '{}', '\s+', ' ', 'g')));
        if v_val #>> '{}' = '' then continue; end if;
      when 'bool' then
        if jsonb_typeof(v_val) <> 'boolean' then raise exception 'INVALID:props'; end if;
      when 'list' then
        -- short texts in order, trimmed, no empty ones, no repeats (case ignored)
        if jsonb_typeof(v_val) <> 'array' then raise exception 'INVALID:props'; end if;
        v_list := '[]';
        for v_item in select * from jsonb_array_elements(v_val) loop
          if jsonb_typeof(v_item) <> 'string' then raise exception 'INVALID:props'; end if;
          v_t := btrim(regexp_replace(v_item #>> '{}', '\s+', ' ', 'g'));
          if v_t = '' then continue; end if;
          if char_length(v_t) > coalesce((v_spec ->> 'max_len')::integer, 40) then raise exception 'INVALID:props'; end if;
          if exists (select 1 from jsonb_array_elements_text(v_list) x where lower(x) = lower(v_t)) then continue; end if;
          v_list := v_list || to_jsonb(v_t);
        end loop;
        if jsonb_array_length(v_list) > coalesce((v_spec ->> 'max_items')::integer, 12) then raise exception 'INVALID:props'; end if;
        if jsonb_array_length(v_list) = 0 then continue; end if;
        v_val := v_list;
      else raise exception 'INVALID:props';
    end case;
    v_out := v_out || jsonb_build_object(v_key, v_val);
  end loop;
  return v_out;
end $$;

update maps.types set props = props || '{"lanes": {"kind": "list", "max_items": 12, "max_len": 40, "label": "Lanes"}}'::jsonb
where id = 'general';

-- ---------------------------------------------------------------------------
-- 2. Import with arrows. Items: [{ depth, title, notes, special: [], type, props: {}, place: {}, key, next: [{ to, label }] }]
--    In a flowchart: under the centre only, depth 0, type 'process' when none is given; arrows by key, inside the items.
-- ---------------------------------------------------------------------------
create or replace function maps.add_items(p_ctx jsonb, p_map maps.maps, p_parent uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_item jsonb; v_depth integer; v_prev integer := -1; v_stack uuid[] := '{}'; v_par uuid; v_id uuid;
  v_first uuid; v_sort integer; v_clean jsonb := '[]'; v_k integer := 0; v_uid uuid := (p_ctx ->> 'id')::uuid;
  v_flow boolean := p_map.kind = 'flowchart'; v_type text; v_key text; v_keys jsonb := '{}'; v_ids jsonb := '{}'; v_next jsonb;
  v_arrow jsonb; v_to text; v_label text; v_arrows integer := 0; v_pairs text[] := '{}'; v_root uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'INVALID:items'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'INVALID:items'; end if;
  select count(*) into v_n from maps.branches b where b.map_id = p_map.id and b.deleted_at is null;
  if v_n + jsonb_array_length(p_items) > 2000 then raise exception 'INVALID:size'; end if;
  if v_flow then
    select b.id into v_root from maps.branches b where b.map_id = p_map.id and b.parent_id is null;
    if p_parent <> v_root then raise exception 'INVALID:parent'; end if;
  end if;
  -- check everything first
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'INVALID:items'; end if;
    v_type := coalesce(v_item ->> 'type', case when v_flow then 'process' else 'general' end);
    if v_flow and coalesce((v_item ->> 'depth')::integer, 0) <> 0 then raise exception 'INVALID:items'; end if;
    v_key := nullif(btrim(coalesce(v_item ->> 'key', '')), '');
    if v_key is not null then
      if char_length(v_key) > 60 or v_keys ? v_key then raise exception 'INVALID:items'; end if;
      v_keys := v_keys || jsonb_build_object(v_key, true);
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'depth', greatest(coalesce((v_item ->> 'depth')::integer, 0), 0),
      'title', maps.clean_title(v_item ->> 'title'),
      'notes', maps.clean_notes(v_item ->> 'notes'),
      'special', to_jsonb(maps.clean_special(v_item -> 'special')),
      'type', v_type,
      'props', maps.clean_props(v_type, p_map.kind, v_item -> 'props'),
      'place', maps.clean_place(v_item -> 'place'),
      'key', v_key,
      'next', coalesce(v_item -> 'next', '[]'::jsonb)));
  end loop;
  -- arrows: only in a flowchart, from an item with a key to another item's key, at most 20 from one step
  for v_item in select * from jsonb_array_elements(v_clean) loop
    v_next := v_item -> 'next';
    if jsonb_typeof(v_next) <> 'array' then raise exception 'INVALID:items'; end if;
    if jsonb_array_length(v_next) = 0 then continue; end if;
    if not v_flow or v_item ->> 'key' is null or jsonb_array_length(v_next) > 20 then raise exception 'INVALID:items'; end if;
    for v_arrow in select * from jsonb_array_elements(v_next) loop
      v_to := v_arrow ->> 'to';
      v_label := btrim(regexp_replace(coalesce(v_arrow ->> 'label', ''), '\s+', ' ', 'g'));
      if v_to is null or not (v_keys ? v_to) or v_to = v_item ->> 'key' then raise exception 'INVALID:items'; end if;
      if char_length(v_label) > 40 then raise exception 'INVALID:label'; end if;
      if (v_item ->> 'key') || '>' || v_to = any (v_pairs) then raise exception 'INVALID:items'; end if;
      v_pairs := v_pairs || ((v_item ->> 'key') || '>' || v_to);
    end loop;
  end loop;
  -- then write
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
    if v_item ->> 'key' is not null then v_ids := v_ids || jsonb_build_object(v_item ->> 'key', v_id); end if;
    v_stack := v_stack[1:v_depth] || v_id;
    v_prev := v_depth; v_k := v_k + 1;
    if v_first is null then v_first := v_id; end if;
  end loop;
  for v_item in select * from jsonb_array_elements(v_clean) loop
    v_n := 0;
    for v_arrow in select * from jsonb_array_elements(v_item -> 'next') loop
      insert into maps.lines (map_id, from_id, to_id, kind, rel, label, sort, created_by, created_by_name, updated_by, updated_by_name)
      values (p_map.id, (v_ids ->> (v_item ->> 'key'))::uuid, (v_ids ->> (v_arrow ->> 'to'))::uuid, 'flow', 'next',
        btrim(regexp_replace(coalesce(v_arrow ->> 'label', ''), '\s+', ' ', 'g')), v_n, v_uid, p_ctx ->> 'name', v_uid, p_ctx ->> 'name');
      v_n := v_n + 1; v_arrows := v_arrows + 1;
    end loop;
  end loop;
  return jsonb_build_object('added', v_k, 'first', v_first, 'arrows', v_arrows);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Functions the pages call
-- ---------------------------------------------------------------------------

-- A new map: knowledge or flowchart (piping and wiring come in steps 4 and 5).
create or replace function public.maps_create(p_name text, p_kind text, p_share text, p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_name text; v_map maps.maps; v_root uuid; v_n integer; v_add jsonb; v_kind text := coalesce(p_kind, 'knowledge');
begin
  v_ctx := maps.ctx('edit'); v_uid := (v_ctx ->> 'id')::uuid;
  v_name := maps.clean_title(p_name, 80);
  if v_kind not in ('knowledge', 'flowchart') then raise exception 'INVALID:kind'; end if;
  if coalesce(p_share, 'private') not in ('private', 'team_read', 'team_edit') then raise exception 'INVALID:share'; end if;
  if exists (select 1 from maps.maps m where m.owner_id = v_uid and m.deleted_at is null and lower(m.name) = lower(v_name)) then
    raise exception 'INVALID:name_taken';
  end if;
  select count(*) into v_n from maps.maps m where m.owner_id = v_uid and m.deleted_at is null;
  if v_n >= 200 then raise exception 'INVALID:too_many'; end if;
  insert into maps.maps (name, kind, share, owner_id, owner_name, updated_by, updated_by_name)
  values (v_name, v_kind, coalesce(p_share, 'private'), v_uid, v_ctx ->> 'name', v_uid, v_ctx ->> 'name')
  returning * into v_map;
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
    jsonb_build_object('name', v_map.name, 'kind', v_map.kind, 'share', v_map.share, 'starter', coalesce((v_add ->> 'added')::integer, 0)));
  perform core.audit('maps', 'map_create', jsonb_build_object('map', v_map.id, 'kind', v_map.kind, 'share', v_map.share));
  return jsonb_build_object('id', v_map.id);
end $$;
revoke execute on function public.maps_create(text, text, text, jsonb) from public, anon;
grant execute on function public.maps_create(text, text, text, jsonb) to authenticated;

-- A new branch under p_parent, last among its branches. A verifier's own branch starts verified.
-- In a flowchart: a Process step, directly under the centre.
create or replace function public.maps_branch_add(p_parent uuid, p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_par maps.branches; v_map maps.maps; v_n integer; v_b maps.branches; v_ver boolean;
begin
  v_ctx := maps.ctx(); v_uid := (v_ctx ->> 'id')::uuid;
  v_par := maps.branch_for(v_ctx, p_parent, 'edit');
  select * into v_map from maps.maps m where m.id = v_par.map_id;
  if v_map.kind = 'flowchart' and v_par.parent_id is not null then raise exception 'INVALID:parent'; end if;
  select count(*) into v_n from maps.branches b where b.map_id = v_map.id and b.deleted_at is null;
  if v_n >= 2000 then raise exception 'INVALID:size'; end if;
  v_ver := (v_ctx ->> 'verifier')::boolean;
  insert into maps.branches (map_id, parent_id, sort, title, type, verified, verified_by, verified_by_name, verified_at,
    created_by, created_by_name, updated_by, updated_by_name)
  values (v_map.id, v_par.id, (select coalesce(max(b.sort) + 1, 0) from maps.branches b where b.parent_id = v_par.id and b.deleted_at is null),
    maps.clean_title(p_title), case when v_map.kind = 'flowchart' then 'process' else 'general' end,
    v_ver, case when v_ver then v_uid end, case when v_ver then v_ctx ->> 'name' end, case when v_ver then now() end,
    v_uid, v_ctx ->> 'name', v_uid, v_ctx ->> 'name')
  returning * into v_b;
  if v_ver then update maps.branches set verified_fact = maps.fact(id) where id = v_b.id returning * into v_b; end if;
  perform maps.touch_map(v_ctx, v_map.id);
  perform maps.log(v_ctx, v_map.id, v_b.id, null, 'branch_add', null, maps.snap(v_b.id));
  return maps.branch_json(v_b, '{}'::jsonb);
end $$;
revoke execute on function public.maps_branch_add(uuid, text) from public, anon;
grant execute on function public.maps_branch_add(uuid, text) to authenticated;

-- Move a branch: under p_parent (same map, not inside itself) at position p_index among its branches.
-- In a flowchart steps stay under the centre (the order is the reading order of the Outline).
create or replace function public.maps_branch_move(p_branch uuid, p_parent uuid, p_index integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_b maps.branches; v_par maps.branches; v_ids uuid[]; v_i integer; v_kind text;
begin
  v_ctx := maps.ctx();
  v_b := maps.branch_for(v_ctx, p_branch, 'edit');
  if v_b.parent_id is null then raise exception 'INVALID:branch'; end if;
  select * into v_par from maps.branches b where b.id = coalesce(p_parent, v_b.parent_id) and b.deleted_at is null and b.map_id = v_b.map_id;
  if not found then raise exception 'INVALID:parent'; end if;
  select m.kind into v_kind from maps.maps m where m.id = v_b.map_id;
  if v_kind = 'flowchart' and v_par.parent_id is not null then raise exception 'INVALID:parent'; end if;
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

-- A line from a branch:
--   'link' to another branch (p_rel = what it means), in this map or another the caller may open;
--   'web'  p_target an https address;
--   'tile' p_target '<tile-id>' or '<tile-id>/<path>' (a page of another tile, opened at /<tile-id>/...);
--   'flow' an arrow to the next step of the same flowchart, p_label the answer (Yes, No ...), up to 40 characters.
create or replace function public.maps_line_add(p_from uuid, p_kind text, p_rel text, p_to uuid, p_target text, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_from maps.branches; v_to maps.branches; v_rel text; v_target text; v_id uuid; v_n integer; v_kind text;
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
  elsif p_kind = 'tile' then
    v_rel := 'tile';
    v_target := regexp_replace(btrim(coalesce(p_target, '')), '^/+', '');
    if v_target !~ '^[a-z][a-z0-9-]{1,30}(/[A-Za-z0-9._~%/?=&#+-]*)?$' or v_target ~ '(\.\.|//)' or char_length(v_target) > 300 then
      raise exception 'INVALID:target';
    end if;
  elsif p_kind = 'flow' then
    v_rel := 'next';
    select m.kind into v_kind from maps.maps m where m.id = v_from.map_id;
    if v_kind <> 'flowchart' then raise exception 'INVALID:kind'; end if;
    if char_length(btrim(coalesce(p_label, ''))) > 40 then raise exception 'INVALID:label'; end if;
    if v_from.parent_id is null or p_to is null or p_to = v_from.id then raise exception 'INVALID:to'; end if;
    select * into v_to from maps.branches b where b.id = p_to and b.deleted_at is null and b.map_id = v_from.map_id and b.parent_id is not null;
    if not found then raise exception 'INVALID:to'; end if;
    if exists (select 1 from maps.lines l where l.from_id = v_from.id and l.to_id = v_to.id and l.kind = 'flow') then raise exception 'INVALID:duplicate'; end if;
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
    jsonb_build_object('kind', p_kind, 'rel', v_rel, 'to', v_to.id, 'to_title', v_to.title, 'target', v_target,
      'label', btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'))));
  return jsonb_build_object('id', v_id, 'version', 1);
end $$;
revoke execute on function public.maps_line_add(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.maps_line_add(uuid, text, text, uuid, text, text) to authenticated;

-- Change what a line means or its text (edit right on the map it starts in). p_version as for branches.
-- An arrow keeps its kind; only its label (the answer) changes.
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
  if v_l.kind in ('web', 'tile', 'flow') and v_rel <> v_l.rel then raise exception 'INVALID:rel'; end if;
  v_label := btrim(regexp_replace(coalesce(p_label, v_l.label), '\s+', ' ', 'g'));
  if char_length(v_label) > (case when v_l.kind = 'flow' then 40 else 120 end) then raise exception 'INVALID:label'; end if;
  if v_rel = v_l.rel and v_label = v_l.label then return jsonb_build_object('id', v_l.id, 'version', v_l.version); end if;
  update maps.lines set rel = v_rel, label = v_label, version = version + 1, updated_at = now(),
    updated_by = (v_ctx ->> 'id')::uuid, updated_by_name = v_ctx ->> 'name' where id = v_l.id;
  perform maps.touched(v_ctx, v_l.from_id);
  perform maps.touch_map(v_ctx, v_l.map_id);
  perform maps.log(v_ctx, v_l.map_id, v_l.from_id, v_l.id, 'line_edit', jsonb_build_object('kind', v_l.kind, 'rel', v_l.rel, 'label', v_l.label),
    jsonb_build_object('kind', v_l.kind, 'rel', v_rel, 'label', v_label));
  return jsonb_build_object('id', v_l.id, 'version', v_l.version + 1);
end $$;
revoke execute on function public.maps_line_save(uuid, integer, text, text) from public, anon;
grant execute on function public.maps_line_save(uuid, integer, text, text) to authenticated;

-- Nothing in schema maps is callable by the browser roles.
revoke execute on all functions in schema maps from public, anon, authenticated;

select core.applied('maps', '003_flowcharts');
