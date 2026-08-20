import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * DB 接続。**pg の型をこのファイルの外へ出さない。**
 *
 * `import "server-only"` は付けていない。付けると、素の Node で動く
 * シードスクリプトとテストから読めなくなるため。代わりに
 * tests/guards/db-boundary.test.ts で「pg を import してよいのは lib/db/ だけ」を
 * 検査する。
 *
 * Supabase ではなく素の PostgreSQL クライアントを使う。理由は CLAUDE.md の
 * 「Supabase 固有機能に深く依存しない。素の PostgreSQL と標準 SQL で書く」。
 * Supabase へ接続する場合も接続文字列を DATABASE_URL に入れれば動く。
 *
 * 注意（docs/SECURITY.md §3）:
 * この接続はアプリ用ロールとして DB へ直結するため、Supabase の RLS は
 * 経由しない。**所有者・権限の検証は API 層で必ず行うこと。** RLS は
 * PostgREST 経由のアクセスに対する二重防御の片方として残している。
 *
 * TODO(要確認): 本番では所有者ロールではなく、必要な権限だけを持つ
 * アプリ専用ロールで接続する。scores への INSERT を許すロールを分けるかどうかは
 * 運用方針とあわせて決める。
 */

let pool: Pool | undefined;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL が設定されていない");
  }

  // 1クラス30〜40名の同時利用を想定（docs/BASIC_DESIGN_v03.md §13）。
  // 実測して調整する。
  pool = new Pool({ connectionString, max: 10 });
  return pool;
}

/** SELECT / INSERT を1文だけ実行する */
export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

/** 0件なら null、1件ならその行。2件以上は呼び出し側の SQL の誤り */
export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  if (rows.length > 1) {
    throw new Error(`1行を期待したが ${rows.length} 行返った`);
  }
  return rows[0] ?? null;
}

export interface Transaction {
  query<T extends QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

/** 複数文をまとめて実行する。例外が出たら ROLLBACK する */
export async function transaction<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query("begin");
    const tx: Transaction = {
      async query(sql, params = []) {
        const result = await client.query(sql, params as unknown[]);
        return result.rows;
      },
    };
    const value = await fn(tx);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** テストやスクリプトの終了時に接続を閉じる */
export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}
