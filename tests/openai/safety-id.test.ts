import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { safetyIdFor } from "@/lib/openai/safety-id";

/**
 * docs/SECURITY.md §4「生の学籍番号や氏名を OpenAI へ送らない」。
 */

const STUDENT_ID = "33333333-3333-4333-8333-333333333333";
const original = process.env.SAFETY_ID_SALT;

describe("Safety Identifier", () => {
  beforeEach(() => {
    process.env.SAFETY_ID_SALT = "test-salt";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SAFETY_ID_SALT;
    else process.env.SAFETY_ID_SALT = original;
  });

  it("同じ生徒なら毎回同じ値になる", () => {
    expect(safetyIdFor(STUDENT_ID)).toBe(safetyIdFor(STUDENT_ID));
  });

  it("生の student_id を含まない", () => {
    const id = safetyIdFor(STUDENT_ID);
    expect(id).not.toContain(STUDENT_ID);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ソルトが変われば値も変わる", () => {
    const first = safetyIdFor(STUDENT_ID);
    process.env.SAFETY_ID_SALT = "another-salt";
    expect(safetyIdFor(STUDENT_ID)).not.toBe(first);
  });

  it("ソルト未設定なら例外。黙って弱い値を使わない", () => {
    delete process.env.SAFETY_ID_SALT;
    expect(() => safetyIdFor(STUDENT_ID)).toThrow(/SAFETY_ID_SALT/);
  });
});
