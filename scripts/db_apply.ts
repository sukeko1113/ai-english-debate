/**
 * DB へ shim・migration・シードを流す。**OS を問わない。**
 *
 *   DATABASE_URL=postgres://... npm run db:apply
 *
 * PostgreSQL の用意（インストール・起動・DB 作成）は各 OS の手順で行う。
 * ここはすでに存在する DB に対して中身を作るだけ。
 *
 * bash ではなく TypeScript にしてあるのは、別の PC が macOS / Windows でも
 * 同じコマンドで動くようにするため（scripts/local_db.sh は Linux 専用）。
 */

import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { closePool, query } from "../lib/db/client";

const SHIM = join("supabase", "dev", "local_auth_shim.sql");
const MIGRATIONS_DIR = join("supabase", "migrations");
const DEV_SEED = join("supabase", "seeds", "dev_seed.sql");

function readSql(path: string): string {
  return readFileSync(path, "utf8");
}

async function appliedMigrations(): Promise<Set<string>> {
  await query(
    `create table if not exists schema_migrations (
       filename   text primary key,
       applied_at timestamptz not null default now())`,
  );
  const rows = await query<{ filename: string }>(
    `select filename from schema_migrations`,
  );
  return new Set(rows.map((row) => row.filename));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL が設定されていない。.env に接続先を書くか、環境変数で渡すこと",
    );
  }

  // 素の PostgreSQL には auth.uid() が無く、0001 の RLS が流れない。
  // **開発用。Supabase では実行しない**（supabase/dev/local_auth_shim.sql 参照）
  console.log("auth シムを流す（ローカル専用）");
  await query(readSql(SHIM));

  const applied = await appliedMigrations();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of files) {
    if (applied.has(name)) {
      console.log(`migration: ${name} (適用済み・スキップ)`);
      continue;
    }
    console.log(`migration: ${name}`);
    await query(readSql(join(MIGRATIONS_DIR, name)));
    await query(`insert into schema_migrations (filename) values ($1)`, [name]);
  }

  console.log(`seed: ${DEV_SEED}`);
  await query(readSql(DEV_SEED));

  console.log("");
  console.log("完了。次は教材の投入: npm run seed:content");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
