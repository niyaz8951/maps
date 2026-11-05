#!/bin/bash
# Database check on a throw-away local Postgres (16+): the Supabase stand-in and the core SQL from the dame-hub clone next
# to this repo, then db/maps/*.sql in order, then db/maps/tests.sql. Not part of the delivery to Supabase.
#   PGARGS   default "-h /tmp -p 5499 -U postgres -d dame_maps"
#   DAME_HUB default ../dame-hub (a clone of the admin repo)
set -e
cd "$(dirname "$0")/../.."
: "${PGARGS:=-h /tmp -p 5499 -U postgres -d dame_maps}"
: "${DAME_HUB:=../dame-hub}"
DB=$(echo "$PGARGS" | sed -n 's/.*-d \([^ ]*\).*/\1/p')
ADMIN=$(echo "$PGARGS" | sed "s/-d $DB/-d postgres/")
psql $ADMIN -qc "drop database if exists $DB" ; psql $ADMIN -qc "create database $DB"
run() { psql $PGARGS -q -v ON_ERROR_STOP=1 -f "$1" > /dev/null; }
run "$DAME_HUB/dev/test/supabase-stub.sql"
for f in "$DAME_HUB"/db/core/0*.sql; do run "$f"; done
# the tile is registered in Admin > Tiles before 001 runs (off)
psql $PGARGS -qc "insert into core.tiles (id, name, tagline, icon, enabled, rights) values ('maps', 'Maps', 'Knowledge, piping and wiring maps', 'map', false, array['edit','verify'])"
for f in db/maps/0*.sql; do run "$f"; echo "applied $f"; done
psql $PGARGS -Atc "select count(*) || ' security problem(s)' from core.security_check()"
psql $PGARGS -q -v ON_ERROR_STOP=1 -f db/maps/tests.sql 2>&1 | grep -E 'ERROR|PASSED|FAILED|expected|CONTEXT' || true
