import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md「秘密情報と生徒実データをコミットしない」の最低限の確認。
 */

const REPO_ROOT = process.cwd();

describe("リポジトリの衛生", () => {
  const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  const ignoredPatterns = gitignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  it(".gitignore が .env を無視している", () => {
    const ignoresEnv = ignoredPatterns.some(
      (pattern) => pattern === ".env" || pattern === ".env*",
    );
    expect(ignoresEnv, ".gitignore に .env を残すこと").toBe(true);
  });

  it(".env がリポジトリに存在しない", () => {
    expect(existsSync(join(REPO_ROOT, ".env"))).toBe(false);
  });

  it(".env.example に値が書かれていない", () => {
    const example = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
    const filled = example
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      // 変数名だけ、または開発用の既定値のみを許す
      .filter((line) => /^[A-Z0-9_]+=.+/.test(line))
      .filter((line) => !/^(NEXT_PUBLIC_APP_URL|NEXTAUTH_URL|SCORER_PROMPT_VERSION|REALTIME_SESSIONS_PER_HOUR|REALTIME_VAD_EAGERNESS)=/.test(line));

    expect(filled, ".env.example には変数名だけを書くこと").toEqual([]);
  });
});
