-- Local browser testing only (dev/test/db.sh database). NEVER run on a Supabase project.
-- Accounts, password Local-Pass-2026 for all: mt_owner (super user), mt_admin (manage), mt_edit (contribute),
-- mt_verify (approve), mt_read (read). Levels as in core 011.
update core.tiles set enabled = true where id = 'maps';
do $$
declare v_name text; v_id uuid;
begin
  foreach v_name in array array['mt_owner', 'mt_admin', 'mt_edit', 'mt_verify', 'mt_read'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, raw_user_meta_data, email_confirmed_at, confirmation_token, recovery_token)
    values (v_id, v_name || '@users.dame-hub.local', extensions.crypt('Local-Pass-2026', extensions.gen_salt('bf')),
      jsonb_build_object('username', v_name, 'display_name', initcap(replace(v_name, 'mt_', 'Test '))), now(), '', '');
  end loop;
  update core.profiles set status = 'active' where username like 'mt\_%';
  update core.profiles set is_super = true where username = 'mt_owner';
  insert into core.tile_access (user_id, tile_id, level) select id, 'maps', 'manage' from core.profiles where username = 'mt_admin';
  insert into core.tile_access (user_id, tile_id, level) select id, 'maps', 'contribute' from core.profiles where username = 'mt_edit';
  insert into core.tile_access (user_id, tile_id, level) select id, 'maps', 'approve' from core.profiles where username = 'mt_verify';
  insert into core.tile_access (user_id, tile_id, level) select id, 'maps', 'read' from core.profiles where username = 'mt_read';
end $$;
