-- Maps tile: process flows (owner, 2026-11-05: "add all the things needed to make such flow diagrams").
-- Touches only: schema maps, functions public.maps_*. No new table or column, no grant to anon or public.
-- Needs db/maps/001 to 004. Read it, then paste it whole in the SQL editor. Then: select * from core.security_check();  (no rows)
--
-- What it does:
--   1. Reply arrows: an arrow ('flow' line) is 'next' (escalate, go on) or 'reply' (answer back); a reply is drawn
--      dashed beside the arrow it answers. maps_line_add / maps_line_save / Import take p_rel 'reply' ("reply": true).
--   2. A Note shape (type 'note'): a box beside the chart with no arrows; the checks leave it alone.
--   3. Every flowchart shape also takes 'group' (a bracket with that name beside the steps that share it) and
--      'show_notes' (the step's notes shown inside its box, e.g. a list of roles).
--   4. The centre takes 'style': 'flowchart' (Start to End, fully checked) or 'process' (a process flow, such as an
--      escalation ladder: Start and End optional, steps may branch).

update maps.types set props = props || '{"group": {"kind": "text", "max_len": 40, "label": "Group"},
  "show_notes": {"kind": "bool", "label": "Show the notes in the box"}}'::jsonb
where kinds = array['flowchart'];

insert into maps.types (id, name, kinds, props, sort) values
  ('note', 'Note (beside the chart)', array['flowchart'], '{}'::jsonb, 20)
on conflict (id) do nothing;

update maps.types set props = props || '{"style": {"kind": "enum", "values": ["flowchart", "process"], "label": "Kind of chart"}}'::jsonb
where id = 'general';

-- Import with arrows: an arrow may be a reply ("reply": true); never to or from a Note.
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
      -- a Note stands beside the chart: no arrow to or from it
      if v_item ->> 'type' = 'note' or exists (select 1 from jsonb_array_elements(v_clean) o where o ->> 'key' = v_to and o ->> 'type' = 'note') then
        raise exception 'INVALID:items';
      end if;
      if v_arrow ? 'reply' and jsonb_typeof(v_arrow -> 'reply') <> 'boolean' then raise exception 'INVALID:items'; end if;
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
      values (p_map.id, (v_ids ->> (v_item ->> 'key'))::uuid, (v_ids ->> (v_arrow ->> 'to'))::uuid, 'flow', case when (v_arrow ->> 'reply')::boolean then 'reply' else 'next' end,
        btrim(regexp_replace(coalesce(v_arrow ->> 'label', ''), '\s+', ' ', 'g')), v_n, v_uid, p_ctx ->> 'name', v_uid, p_ctx ->> 'name');
      v_n := v_n + 1; v_arrows := v_arrows + 1;
    end loop;
  end loop;
  return jsonb_build_object('added', v_k, 'first', v_first, 'arrows', v_arrows);
end $$;

-- A line from a branch: as in 003; an arrow ('flow') may be p_rel 'next' (default) or 'reply', never to or from a Note.
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
    v_rel := coalesce(nullif(p_rel, ''), 'next');
    if v_rel not in ('next', 'reply') then raise exception 'INVALID:rel'; end if;
    select m.kind into v_kind from maps.maps m where m.id = v_from.map_id;
    if v_kind <> 'flowchart' then raise exception 'INVALID:kind'; end if;
    if char_length(btrim(coalesce(p_label, ''))) > 40 then raise exception 'INVALID:label'; end if;
    if v_from.parent_id is null or v_from.type = 'note' or p_to is null or p_to = v_from.id then raise exception 'INVALID:to'; end if;
    select * into v_to from maps.branches b where b.id = p_to and b.deleted_at is null and b.map_id = v_from.map_id and b.parent_id is not null and b.type <> 'note';
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

-- An arrow may change between 'next' and 'reply'; other lines keep their kind and meaning rules.
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
  if v_l.kind in ('web', 'tile') and v_rel <> v_l.rel then raise exception 'INVALID:rel'; end if;
  if v_l.kind = 'flow' and v_rel not in ('next', 'reply') then raise exception 'INVALID:rel'; end if;
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

select core.applied('maps', '005_process_flow');
