#!/bin/bash
# ローカル PostgreSQL に DB を作り、migration とシードを流す。
#
#   bash scripts/local_db.sh
#
# Claude Code のクラウドセッション / ローカルの開発用。Supabase には使わない。
# 何度実行してもよい（--reset で作り直す）。
set -euo pipefail

DB_NAME="${PGDATABASE:-aied}"
DB_USER="${PGUSER:-aied}"
DB_PASS="${PGPASSWORD:-aied}"
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5432}"
RESET=0

for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    *) echo "不明な引数: $arg" >&2; exit 2 ;;
  esac
done

if ! pg_isready -q -h "$DB_HOST" -p "$DB_PORT" 2>/dev/null; then
  echo "PostgreSQL を起動する"
  service postgresql start
  for _ in $(seq 1 20); do
    pg_isready -q -h "$DB_HOST" -p "$DB_PORT" && break
    sleep 1
  done
fi

# 開発用ロール。ローカル専用なのでパスワードは固定でよい
su postgres -c "psql -q -v ON_ERROR_STOP=1 <<SQL
do \\\$\\\$
begin
  if not exists (select 1 from pg_roles where rolname = '${DB_USER}') then
    create role ${DB_USER} with login superuser password '${DB_PASS}';
  end if;
end
\\\$\\\$;
SQL"

if [ "$RESET" = "1" ]; then
  su postgres -c "psql -q -c 'drop database if exists ${DB_NAME};'"
fi

if ! su postgres -c "psql -tAc \"select 1 from pg_database where datname='${DB_NAME}'\"" | grep -q 1; then
  su postgres -c "createdb -O ${DB_USER} ${DB_NAME}"
  echo "データベース ${DB_NAME} を作成した"
fi

export PGPASSWORD="$DB_PASS"
PSQL="psql -q -v ON_ERROR_STOP=1 -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME}"

echo "auth シムを流す（ローカル専用）"
$PSQL -f supabase/dev/local_auth_shim.sql

# 適用済み migration を記録して、2回目以降は飛ばす。
# 本番は Supabase 側の migration 管理を使うので、この表はローカル専用。
$PSQL -c "create table if not exists schema_migrations (
            filename   text primary key,
            applied_at timestamptz not null default now());"

for migration in supabase/migrations/*.sql; do
  name="$(basename "$migration")"
  applied="$($PSQL -tAc "select 1 from schema_migrations where filename = '${name}'")"
  if [ "$applied" = "1" ]; then
    echo "migration: $name (適用済み・スキップ)"
    continue
  fi
  echo "migration: $name"
  $PSQL -f "$migration"
  $PSQL -c "insert into schema_migrations (filename) values ('${name}');"
done

echo "seed: supabase/seeds/dev_seed.sql"
$PSQL -f supabase/seeds/dev_seed.sql

echo
echo "DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "教材の投入: npm run seed:content"
