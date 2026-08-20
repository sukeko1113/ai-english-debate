import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md「DB アクセスは lib/db/ に集約する」の強制。
 *
 * DB クライアント（pg / @supabase/supabase-js）を import してよいのは
 * lib/db/ の中だけ。将来 GCP 等へ移すとき、差し替え範囲を lib/db/ に閉じるため。
 */

const REPO_ROOT = process.cwd();
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "out",
  "build",
]);
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts"];

// lib/db/ の中と、このテスト自身だけが例外
const ALLOWED_PREFIXES = ["lib/db/"];
const SELF = "tests/guards/db-boundary.test.ts";

const DB_CLIENT_IMPORT =
  /(?:from\s+|require\()\s*["'](pg|pg-pool|@supabase\/[^"']+)["']/;

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collectSourceFiles(abs, found);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) found.push(abs);
  }
  return found;
}

describe("DB アクセスの境界", () => {
  const files = collectSourceFiles(REPO_ROOT)
    .map((abs) => relative(REPO_ROOT, abs))
    .filter((rel) => rel !== SELF)
    .sort();

  it("走査対象のソースファイルを見つけられている", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("DB クライアントを import してよいのは lib/db/ だけ", () => {
    const violations = files.filter((rel) => {
      if (ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
        return false;
      }
      return DB_CLIENT_IMPORT.test(readFileSync(join(REPO_ROOT, rel), "utf8"));
    });

    expect(
      violations,
      "DB アクセスは lib/db/ 経由にすること（CLAUDE.md 技術方針）",
    ).toEqual([]);
  });
});
