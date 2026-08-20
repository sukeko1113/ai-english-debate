import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/SECURITY.md §1 と docs/API_SPEC.md「実装上の注意」の強制。
 *
 * - OPENAI_API_KEY を読んでよいのは lib/openai/client.ts だけ
 * - OpenAI 関連の値を NEXT_PUBLIC_* に置かない（ブラウザへ露出する）
 *
 * このファイル自身は検査対象から除外する（禁止文字列を含むため）。
 */

const REPO_ROOT = process.cwd();
const ALLOWED_KEY_READER = join("lib", "openai", "client.ts");

/**
 * テストは lib/openai/client.ts を動かすために OPENAI_API_KEY を設定してよい。
 * 出荷されるコード（app / components / lib / scripts / supabase）が対象。
 */
const ALLOWED_PREFIXES = [`tests${sep}`];
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "out",
  "build",
]);

// 検査対象のソース拡張子
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collectSourceFiles(abs, found);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(abs);
    }
  }
  return found;
}

// 自分自身がヒットしないよう、禁止語は組み立てて作る
const API_KEY_NEEDLE = ["process", "env", "OPENAI_API_KEY"].join(".");
const PUBLIC_OPENAI_PATTERN = /NEXT_PUBLIC_[A-Z0-9_]*OPENAI/;

const SELF = join("tests", "guards", "openai-key.test.ts");

const sourceFiles = collectSourceFiles(REPO_ROOT)
  .map((abs) => relative(REPO_ROOT, abs))
  .filter((rel) => rel !== SELF)
  .sort();

describe("OPENAI_API_KEY の取り扱い", () => {
  it("走査対象のソースファイルを見つけられている", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it("lib/openai/client.ts 以外から OPENAI_API_KEY を読んでいない", () => {
    const violations = sourceFiles.filter((rel) => {
      if (rel === ALLOWED_KEY_READER) return false;
      if (ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
        return false;
      }
      return readFileSync(join(REPO_ROOT, rel), "utf8").includes(API_KEY_NEEDLE);
    });

    expect(
      violations,
      `OPENAI_API_KEY は ${ALLOWED_KEY_READER} からのみ読むこと（docs/SECURITY.md §1）`,
    ).toEqual([]);
  });

  it("OpenAI 関連の値を NEXT_PUBLIC_* で公開していない", () => {
    const violations = sourceFiles.filter((rel) =>
      PUBLIC_OPENAI_PATTERN.test(readFileSync(join(REPO_ROOT, rel), "utf8")),
    );

    expect(
      violations,
      "NEXT_PUBLIC_* はブラウザへ露出する。OpenAI の値を入れないこと",
    ).toEqual([]);
  });
});
