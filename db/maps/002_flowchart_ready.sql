-- Maps tile: the schema accepts flowcharts (owner, 2026-11-05). No screens yet; they come in step 3.
-- Touches only: schema maps. No function changes, no new function, no grant.
-- Needs db/maps/001_init.sql. Read it, then paste it whole in the SQL editor. Then: select * from core.security_check();  (no rows)
--
-- What it does:
--   1. A map may be of kind 'flowchart' (knowledge | piping | wiring | flowchart).
--   2. A line may be of kind 'flow': an arrow from one step to the next, its label carries the answer ("Yes", "No").
--      It always has a "to" branch, like a link.
--   3. The flowchart shapes are branch types (ISO 5807 symbols), each with a 'lane' (swimlane: a role or department).
--      'general' may also live in a flowchart (the centre branch, which carries the map's name).
--   The 2D place {x, y, w, h} that "drag to place" will save is already a column of maps.branches (001).
--
-- Still refused until step 3, on purpose: maps_create with kind 'flowchart' (INVALID:kind) and maps_line_add with kind
-- 'flow' (INVALID:kind), so no page can make a flowchart it cannot show yet. Step 3 replaces those two functions and adds
-- the rules for 'flow' lines (same map only, labels on every exit of a decision).

-- 1. Map kind
do $$
declare v_name text;
begin
  select c.conname into v_name from pg_constraint c
   where c.conrelid = 'maps.maps'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%''knowledge''%';
  if v_name is null then raise exception 'maps.maps kind check not found'; end if;
  execute format('alter table maps.maps drop constraint %I', v_name);
end $$;
alter table maps.maps add constraint maps_kind_check
  check (kind in ('knowledge', 'piping', 'wiring', 'flowchart'));

-- 2. Line kind 'flow' (and it needs a "to" branch)
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'maps.lines'::regclass and c.contype = 'c'
       and (pg_get_constraintdef(c.oid) like '%''link''%''pipe''%''wire''%''control''%''web''%''tile''%'
            or pg_get_constraintdef(c.oid) like '%to_id IS NOT NULL%')
  loop
    execute format('alter table maps.lines drop constraint %I', v_name);
  end loop;
end $$;
alter table maps.lines add constraint lines_kind_check
  check (kind in ('link', 'pipe', 'wire', 'control', 'flow', 'web', 'tile'));
alter table maps.lines add constraint lines_to_check
  check ((to_id is not null) = (kind in ('link', 'pipe', 'wire', 'control', 'flow')));

-- 3. Shapes
update maps.types set kinds = array['knowledge', 'piping', 'wiring', 'flowchart'] where id = 'general';

insert into maps.types (id, name, kinds, props, sort)
select v.id, v.name, array['flowchart'], '{"lane": {"kind": "text", "max_len": 40, "label": "Lane"}}'::jsonb, v.sort
from (values
  ('start',      'Start',          10),
  ('end',        'End',            11),
  ('process',    'Process',        12),
  ('decision',   'Decision',       13),
  ('data',       'Input / Output', 14),
  ('document',   'Document',       15),
  ('manual',     'Manual step',    16),
  ('delay',      'Wait',           17),
  ('subprocess', 'Sub-process',    18),
  ('connector',  'Connector',      19)
) as v (id, name, sort)
on conflict (id) do nothing;

select core.applied('maps', '002_flowchart_ready');
