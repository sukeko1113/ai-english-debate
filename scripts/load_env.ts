/**
 * .env を読み込む。**副作用だけのモジュール。**
 *
 * next dev / next build は .env を自動で読むが、素の Node で動く
 * スクリプト（doctor / db:apply / seed:content）は読まない。
 * それらの先頭で、他の import より前にこれを読み込む。
 *
 * Node 22 以降の process.loadEnvFile を使うので依存は増やさない。
 * **すでに設定されている環境変数は上書きしない**ので、
 *   DATABASE_URL=... npm run db:apply
 * のようにコマンドラインで渡した値が優先される（Next と同じ順序）。
 *
 * 読み込みの結果を記録しておき、doctor が「なぜ未設定なのか」を
 * 説明できるようにする（.env が無い / 別名で保存された / 中身が空、など）。
 */

import { existsSync, readdirSync } from "node:fs";

export interface EnvFileLoad {
  file: string;
  loaded: boolean;
  /** 読み込みに失敗したときの理由 */
  error?: string;
}

export interface EnvLoadReport {
  /** 探した場所 */
  cwd: string;
  results: EnvFileLoad[];
  /** .env に似た名前のファイル。.env.txt などの取り違えを見つける */
  lookalikes: string[];
}

function findLookalikes(): string[] {
  try {
    return readdirSync(".")
      .filter((name) => name.startsWith(".env"))
      .sort();
  } catch {
    return [];
  }
}

function load(): EnvLoadReport {
  const results: EnvFileLoad[] = [];

  // Next.js と同じく .env.local を .env より優先する
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) {
      results.push({ file, loaded: false });
      continue;
    }
    try {
      process.loadEnvFile(file);
      results.push({ file, loaded: true });
    } catch (error) {
      results.push({
        file,
        loaded: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { cwd: process.cwd(), results, lookalikes: findLookalikes() };
}

export const envLoadReport: EnvLoadReport = load();
