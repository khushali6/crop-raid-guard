#!/usr/bin/env bash
# Applies all migrations to a disposable Supabase Postgres container and runs the SQL tests.
# Usage: supabase/tests/run_local.sh   (needs Docker)
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${SUPABASE_PG_IMAGE:-supabase/postgres:17.6.1.166}"
NAME="${CONTAINER_NAME:-crg-pg-test}"
PORT="${PG_PORT:-54329}"

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p "$PORT:5432" "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  sleep 3
fi

psql_admin() { docker exec -i "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql_admin -c "drop schema if exists public cascade; create schema public;
  grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;"
psql_admin < tests/storage_stub.sql
psql_admin -c "delete from storage.buckets;"
psql_admin -c "do \$\$ begin if exists (select 1 from pg_publication_tables where pubname='supabase_realtime') then
  execute 'alter publication supabase_realtime set table storage.buckets'; end if; end \$\$;" >/dev/null 2>&1 || true

for f in migrations/*.sql; do
  echo "applying $f"
  psql_admin < "$f"
done
docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < tests/rls_test.sql | grep -E "passed|ERROR" || { echo "SQL tests failed"; exit 1; }
