-- Maps tile, step 2: the review list for verifiers, and "send back with a comment".
-- Touches only: schema maps, functions public.maps_*. Adds five columns to maps.branches (review_*); no new table, no grant to anon.
-- Needs db/maps/001 to 003. Read it, then paste it whole in the SQL editor. Then: select * from core.security_check();  (no rows)
--
-- What it does:
--   maps_review()                      every branch to verify, or changed since verified, in every map the verifier may open
--                                      (right 'verify'); up to 300, the newest change first.
--   maps_send_back(branch, comment)    a verifier sends a branch back with a comment: it is "to verify" again and the page
--                                      shows who sent it back, when and why, until a verifier verifies it.
--   maps_verify                        as before, and verifying clears the comment.
--   maps_get                           each branch carries its comment ("review") while there is one.

alter table maps.branches add column if not exists review_note text check (review_note is null or char_length(review_note) between 1 and 500);
alter table maps.branches add column if not exists review_by uuid;           -- no foreign key: accounts can be deleted (core rule)
alter table maps.branches add column if not exists review_by_name text;
alter table maps.branches add column if not exists review_at timestamptz;
alter table maps.branches add column if not exists review_version integer;  -- the branch's version when it was sent back

-- One branch as the page receives it (now with its review comment; "answered" = changed since it was sent back).
create or replace function maps.branch_json(p_b maps.branches, p_names jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_b.id, 'parent', p_b.parent_id, 'sort', p_b.sort, 'title', p_b.title, 'notes', p_b.notes,
    'special', to_jsonb(p_b.special), 'type', p_b.type, 'props', p_b.props, 'place', p_b.place, 'version', p_b.version,
    'status', case when not p_b.verified then 'to_verify' when p_b.verified_fact is distinct from maps.fact(p_b.id) then 'changed' else 'verified' end,
    'verified_by', case when p_b.verified then coalesce(p_names ->> p_b.verified_by::text, p_b.verified_by_name) end,
    'verified_at', case when p_b.verified then p_b.verified_at end,
    'updated_by', coalesce(p_names ->> p_b.updated_by::text, p_b.updated_by_name), 'updated_at', p_b.updated_at,
    'created_by', coalesce(p_names ->> p_b.created_by::text, p_b.created_by_name), 'created_at', p_b.created_at,
    'review', case when p_b.review_at is not null then jsonb_build_object('note', p_b.review_note,
      'by', coalesce(p_names ->> p_b.review_by::text, p_b.review_by_name), 'at', p_b.review_at,
      'answered', p_b.version > coalesce(p_b.review_version, p_b.version)) end);
$$;

-- Verify (right 'verify', any map the verifier may open) or mark "to verify" (verifier or editor of the map).
-- p_deep: the branch and everything under it. Verifying clears a "sent back" comment.
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
        verified_fact = maps.fact(b.id), review_note = null, review_by = null, review_by_name = null, review_at = null, review_version = null
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

-- Every branch waiting for a verifier, across the maps he may open (right 'verify').
create or replace function public.maps_review()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_rows jsonb; v_names jsonb;
begin
  v_ctx := maps.ctx('verify');
  perform maps.purge();
  with open_maps as (
    select m.* from maps.maps m where m.deleted_at is null and maps.right_on(v_ctx, m) <> 'none'
  ), waiting as (
    select b.*, m.name map_name, m.kind map_kind,
      case when not b.verified then 'to_verify' else 'changed' end status
    from maps.branches b join open_maps m on m.id = b.map_id
    where b.deleted_at is null and b.parent_id is not null
      and (not b.verified or b.verified_fact is distinct from maps.fact(b.id))
    order by b.updated_at desc, b.id
    limit 300
  )
  select maps.names(array_agg(w.updated_by) || array_agg(w.review_by)), coalesce(jsonb_agg(jsonb_build_object(
      'map_id', w.map_id, 'map', w.map_name, 'kind', w.map_kind, 'branch_id', w.id, 'title', w.title, 'status', w.status,
      'parent', p.title, 'updated_at', w.updated_at, 'updated_by', w.updated_by, 'updated_by_name', w.updated_by_name,
      'notes', left(w.notes, 300),
      'review', case when w.review_at is not null then jsonb_build_object('note', w.review_note, 'by', w.review_by, 'by_name', w.review_by_name,
        'at', w.review_at, 'answered', w.version > coalesce(w.review_version, w.version)) end) order by w.updated_at desc, w.id), '[]')
    into v_names, v_rows
  from waiting w left join maps.branches p on p.id = w.parent_id;
  -- current names, with the saved ones as fallback
  select coalesce(jsonb_agg(r || jsonb_build_object('updated_by', coalesce(v_names ->> (r ->> 'updated_by'), r ->> 'updated_by_name'),
      'review', case when r -> 'review' = 'null'::jsonb then null else (r -> 'review') || jsonb_build_object('by',
        coalesce(v_names ->> (r -> 'review' ->> 'by'), r -> 'review' ->> 'by_name')) end) - 'updated_by_name'), '[]')
    into v_rows from jsonb_array_elements(v_rows) r;
  return jsonb_build_object('items', v_rows, 'more', jsonb_array_length(v_rows) >= 300);
end $$;
revoke execute on function public.maps_review() from public, anon;
grant execute on function public.maps_review() to authenticated;

-- A verifier sends a branch back: "to verify" again, with why (1 to 500 characters), until a verifier verifies it.
create or replace function public.maps_send_back(p_branch uuid, p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb; v_uid uuid; v_b maps.branches; v_note text;
begin
  v_ctx := maps.ctx('verify'); v_uid := (v_ctx ->> 'id')::uuid;
  v_b := maps.branch_for(v_ctx, p_branch, 'read');
  if v_b.parent_id is null then raise exception 'INVALID:branch'; end if;
  v_note := btrim(regexp_replace(regexp_replace(coalesce(p_comment, ''), E'\r', '', 'g'), '[ \t]+', ' ', 'g'));
  if char_length(v_note) < 1 or char_length(v_note) > 500 then raise exception 'INVALID:comment'; end if;
  update maps.branches set verified = false, verified_by = null, verified_by_name = null, verified_at = null, verified_fact = null,
    review_note = v_note, review_by = v_uid, review_by_name = v_ctx ->> 'name', review_at = now(), review_version = v_b.version
  where id = v_b.id;
  perform maps.touch_map(v_ctx, v_b.map_id);
  perform maps.log(v_ctx, v_b.map_id, v_b.id, null, 'send_back', null, jsonb_build_object('comment', v_note));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.maps_send_back(uuid, text) from public, anon;
grant execute on function public.maps_send_back(uuid, text) to authenticated;

-- Nothing in schema maps is callable by the browser roles.
revoke execute on all functions in schema maps from public, anon, authenticated;

select core.applied('maps', '004_review');
