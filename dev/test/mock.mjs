// Test harness only (copied from dame-hub dev/test/mock-supabase.mjs, 2026-11-05): serves /dame-hub/ from the admin repo
// clone (DAME_HUB, default ../dame-hub) and /maps/ from this repo, and mimics Supabase Auth + PostgREST rpc on the same
// origin, backed by the local Postgres test database (dev/test/db.sh + dev/test/seed-local.sql). Not part of the delivery.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const tile = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hub = resolve(tile, process.env.DAME_HUB || '../dame-hub');
const port = 8080;
const PG = [...(process.env.PGARGS || '-h /tmp -p 5499 -U postgres -d dame_maps').split(' '), '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
const types = { '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const sessions = new Map(); // refresh_token -> { user_id, session_id }

function sql(q) {
  try { return { ok: true, out: execFileSync('psql', [...PG, '-c', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) {
    const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(e.stderr || '');
    const d = /DETAIL:\s+(.*)/.exec(e.stderr || '');
    return { ok: false, code: m ? m[1] : '?', message: m ? m[2].trim() : (e.stderr || '').trim(), details: d ? d[1].trim() : null };
  }
}
const lit = (s) => '$q$' + String(s).replace(/\$q\$/g, '') + '$q$';
function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function token(user_id, session_id) { const e = sql(`select email from auth.users where id = ${lit(user_id)}`); return 'x.' + b64({ sub: user_id, session_id, role: 'authenticated', email: e.ok ? e.out : null, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x'; }
function claims(req) {
  const a = req.headers.authorization || '';
  const m = /^Bearer x\.([^.]+)\.x$/.exec(a);
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1], 'base64url').toString()); } catch { return null; }
}
function session(user_id) {
  const session_id = randomUUID(), refresh_token = randomUUID();
  sessions.set(refresh_token, { user_id, session_id });
  sql(`insert into auth.sessions (id, user_id) values (${lit(session_id)}, ${lit(user_id)})`);
  return { access_token: token(user_id, session_id), refresh_token, expires_in: 3600, token_type: 'bearer', user: { id: user_id } };
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); }
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); const t = Buffer.concat(chunks).toString(); try { return t ? JSON.parse(t) : {}; } catch { return {}; } }

const fnCache = new Map();
function fnInfo(name) {
  if (fnCache.has(name)) return fnCache.get(name);
  const r = sql(`select proretset, prorettype::regtype, coalesce(array_to_string(proargnames, ','), ''), array_to_string(proargtypes::regtype[], ',') from pg_proc where proname = ${lit(name)} and pronamespace = 'public'::regnamespace`);
  if (!r.ok || !r.out) return null;
  const [retset, rettype, names, argtypes] = r.out.split('|');
  const info = { retset: retset === 't', rettype, names: names ? names.split(',') : [], argtypes: argtypes ? argtypes.split(',') : [] };
  fnCache.set(name, info); return info;
}
function argExpr(j, name, type) {
  if (j[name] === null) return `${name} := null::${type}`;
  const v = `(${lit(JSON.stringify(j))}::jsonb -> ${lit(name)})`;
  if (type.endsWith('[]')) return `${name} := (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${v}) x)::${type}`;
  return `${name} := (${lit(JSON.stringify(j))}::jsonb ->> ${lit(name)})::${type}`;
}

async function api(req, res, path, url) {
  // ---- auth
  if (path === '/auth/v1/token') {
    const body = await readBody(req);
    if (url.searchParams.get('grant_type') === 'password') {
      const r = sql(`select id from auth.users where email = ${lit(body.email)} and encrypted_password = extensions.crypt(${lit(body.password)}, encrypted_password)`);
      if (!r.ok || !r.out) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', error_code: 'invalid_credentials' });
      return json(res, 200, session(r.out));
    }
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const s = sessions.get(body.refresh_token);
      const live = s && sql(`select 1 from auth.sessions where id = ${lit(s.session_id)}`);
      if (!s || !live.ok || !live.out) return json(res, 400, { error: 'invalid_grant', msg: 'Invalid Refresh Token' });
      sessions.delete(body.refresh_token);
      const rt = randomUUID(); sessions.set(rt, s);
      return json(res, 200, { access_token: token(s.user_id, s.session_id), refresh_token: rt, expires_in: 3600, user: { id: s.user_id } });
    }
  }
  if (path === '/auth/v1/signup') {
    const body = await readBody(req);
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,}$/.test(body.password || '')) return json(res, 422, { code: 'weak_password', msg: 'Password should contain...' });
    const exists = sql(`select 1 from auth.users where email = ${lit(body.email)}`);
    if (exists.ok && exists.out) return json(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    const r = sql(`insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at, confirmation_token, recovery_token) values (${lit(body.email)}, extensions.crypt(${lit(body.password)}, extensions.gen_salt('bf')), ${lit(JSON.stringify(body.data || {}))}::jsonb, now(), '', '') returning id`);
    if (!r.ok) return json(res, 500, { code: 'unexpected_failure', msg: 'Database error saving new user: ' + r.message });
    return json(res, 200, session(r.out));
  }
  if (path === '/auth/v1/logout') { return json(res, 204); }
  if (path === '/auth/v1/user' && req.method === 'PUT') {
    const c = claims(req); if (!c) return json(res, 401, { msg: 'invalid JWT' });
    const body = await readBody(req);
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,}$/.test(body.password || '')) return json(res, 422, { code: 'weak_password', msg: 'Password should contain...' });
    sql(`update auth.users set encrypted_password = extensions.crypt(${lit(body.password)}, extensions.gen_salt('bf')) where id = ${lit(c.sub)}`);
    return json(res, 200, { id: c.sub });
  }
  // ---- rest rpc
  const m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path);
  if (m) {
    const name = m[1];
    const body = await readBody(req);
    const c = claims(req);
    if (req.headers.authorization && !c) return json(res, 401, { message: 'JWT invalid', code: 'PGRST301' });
    if (c && c.exp < Date.now() / 1000) return json(res, 401, { message: 'JWT expired', code: 'PGRST301' });
    const info = fnInfo(name);
    if (!info) return json(res, 404, { code: 'PGRST202', message: 'Could not find the function public.' + name });
    const args = info.names.map((n, i) => body[n] !== undefined ? argExpr(body, n, info.argtypes[i]) : null).filter(Boolean).join(', ');
    const call = `public.${name}(${args})`;
    const select = info.retset ? `select coalesce(jsonb_agg(r), '[]') from ${call} r` : info.rettype === 'void' ? `select ${call}` : `select to_jsonb(${call})`;
    const role = c ? 'authenticated' : 'anon';
    const q = `begin; select set_config('request.jwt.claims', ${lit(c ? JSON.stringify(c) : '')}, true); set local role ${role}; ${select}; commit;`;
    const r = sql(q);
    if (!r.ok) return json(res, r.code === '42501' ? 403 : 400, { code: r.code, message: r.message, details: r.details || null, hint: null });
    const lines = r.out.split('\n'); const out = lines[lines.length - 1];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(info.rettype === 'void' ? '' : out.replace(/^(BEGIN|SET|COMMIT)$/, 'null'));
  }
  if (path.startsWith('/storage/v1/')) return json(res, 404, { message: 'storage not mocked' });
  return json(res, 404, { message: 'no route' });
}

function root(id) {
  if (id === 'dame-hub') return hub;
  if (id === 'maps') return tile;
  return null;
}
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (path.startsWith('/auth/') || path.startsWith('/rest/') || path.startsWith('/storage/')) return api(req, res, path, url);
  if (path === '/dame-hub/core/v1/config.js') {
    let src = await readFile(join(hub, 'core/v1/config.js'), 'utf8');
    src = src.replace(/url: 'https:\/\/[^']+'/, "url: 'http://localhost:8080'").replace(/key: 'sb_publishable_[^']+'/, "key: 'test'");
    res.writeHead(200, { 'Content-Type': types['.js'] }); return res.end(src);
  }
  const [, id, ...rest] = path.split('/');
  const base = root(id);
  if (!base) { res.writeHead(404); return res.end('404'); }
  let file = resolve(base, rest.join('/'));
  let info = await stat(file).catch(() => null);
  if (info && info.isDirectory()) { file = join(file, 'index.html'); info = await stat(file).catch(() => null); }
  if (!info) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(await readFile(file));
}).listen(port, () => console.log('mock on ' + port));
