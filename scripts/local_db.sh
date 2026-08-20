#!/bin/bash
# ローカル PostgreSQL を起動し、ロールと DB を作ってから db:apply を呼ぶ。
#
#   bash scripts/local_db.sh
#
# **このスクリプトは Linux 専用**（service / su postgres を使う）。
# macOS / Windows では PostgreSQL と DB を各 OS の手順で用意してから
# npm run db:apply を直接実行すること（README「別の PC で動かす」参照）。
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
export DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# shim・migration・シードの適用は OS 非依存の db:apply に任せる。
# ここでしかできないのは、上の「PostgreSQL の起動・ロール作成・DB 作成」だけ
npm run --silent db:apply

echo
echo "DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "教材の投入: npm run seed:content"
