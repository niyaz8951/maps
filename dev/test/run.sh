#!/bin/bash
# Everything local: the database (db.sh: core + maps SQL + tests), test accounts (seed-local.sql), the mock of Supabase on
# localhost:8080 (mock.mjs), then the browser check (e2e.cjs). Needs Postgres 16+ (PGARGS), node 20+, playwright-core, Chrome.
set -e
cd "$(dirname "$0")/../.."
: "${PGARGS:=-h /tmp -p 5499 -U postgres -d dame_maps}"
export PGARGS DAME_HUB="${DAME_HUB:-../dame-hub}"
dev/test/db.sh
psql $PGARGS -q -v ON_ERROR_STOP=1 -f dev/test/seed-local.sql
psql $PGARGS -qc "update core.tiles set accent = 'rose' where id = 'maps'"
node dev/outline-check.mjs | tail -1
node dev/test/mock.mjs > /dev/null 2>&1 & MOCK=$!
sleep 1
node dev/test/e2e.cjs || true
kill $MOCK
