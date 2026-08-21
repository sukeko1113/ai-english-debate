import { describe, expect, it } from "vitest";

import { isAllowed, parseAllowlist } from "@/lib/auth/allowlist";

/**
 * docs/SECURITY.md §3「誰でもサインアップできる状態にしない」。
 * ここが緩むと、Google アカウントを持つ全員が入れて
 * OpenAI の課金を使えることになる。
 */

describe("ログインの許可リスト", () => {
  it("カンマ区切りを読む。空白と大文字小文字は無視する", () => {
    expect(parseAllowlist(" Alice@Example.com , bob@example.com ")).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
  });

  it("未設定なら空", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
  });

  it("載っている人だけ入れる", () => {
    const list = parseAllowlist("alice@example.com,bob@example.com");

    expect(isAllowed("alice@example.com", list)).toBe(true);
    expect(isAllowed("ALICE@example.com", list)).toBe(true);
    expect(isAllowed(" alice@example.com ", list)).toBe(true);
    expect(isAllowed("carol@example.com", list)).toBe(false);
  });

  it("**一覧が空なら誰も入れない**", () => {
    // 設定し忘れたまま公開されたときに、誰でも入れる状態にしない
    expect(isAllowed("alice@example.com", [])).toBe(false);
  });

  it("メールが無いログインは弾く", () => {
    const list = parseAllowlist("alice@example.com");

    expect(isAllowed(null, list)).toBe(false);
    expect(isAllowed(undefined, list)).toBe(false);
    expect(isAllowed("", list)).toBe(false);
  });

  it("部分一致で通さない", () => {
    const list = parseAllowlist("alice@example.com");

    expect(isAllowed("alice@example.com.attacker.test", list)).toBe(false);
    expect(isAllowed("notalice@example.com", list)).toBe(false);
  });
});
