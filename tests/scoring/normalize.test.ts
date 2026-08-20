import { describe, expect, it } from "vitest";

import { normalizeAnswer } from "@/lib/scoring/normalize";

/**
 * docs/RUBRIC.md「確定採点」の正規化ルールを1つずつ固定する。
 */

describe("答案の正規化", () => {
  it("前後の空白を除去し、連続空白を1つにする", () => {
    expect(normalizeAnswer("  I  like   uniforms  ")).toBe("i like uniforms");
    // 全角スペースも空白として扱う
    expect(normalizeAnswer("I　like　uniforms")).toBe("i like uniforms");
    // 改行・タブも同じ
    expect(normalizeAnswer("I like\n\tuniforms")).toBe("i like uniforms");
  });

  it("大文字小文字を無視する", () => {
    expect(normalizeAnswer("I Like Uniforms")).toBe(
      normalizeAnswer("i like uniforms"),
    );
  });

  it("文末の . ! ? を無視する", () => {
    expect(normalizeAnswer("I like uniforms.")).toBe("i like uniforms");
    expect(normalizeAnswer("I like uniforms!")).toBe("i like uniforms");
    expect(normalizeAnswer("I like uniforms?")).toBe("i like uniforms");
    expect(normalizeAnswer("I like uniforms!?")).toBe("i like uniforms");
    // 末尾に空白が挟まっていても落とす
    expect(normalizeAnswer("I like uniforms .")).toBe("i like uniforms");
  });

  it("文中の . ! ? は残す", () => {
    expect(normalizeAnswer("Mr. Smith is here.")).toBe("mr. smith is here");
  });

  it("スマートクォートを ASCII に統一する", () => {
    expect(normalizeAnswer("I don’t like it")).toBe("i don't like it");
    expect(normalizeAnswer("“yes”")).toBe('"yes"');
    // 同じ意味の答案が表記だけで不正解にならないこと
    expect(normalizeAnswer("students’ development")).toBe(
      normalizeAnswer("students' development"),
    );
  });

  it("カンマは無視しない", () => {
    // because の前のカンマ有無は文法事項（docs/RUBRIC.md）
    expect(normalizeAnswer("I like it, because it is easy")).not.toBe(
      normalizeAnswer("I like it because it is easy"),
    );
  });

  it("同じ答案は必ず同じ結果になる", () => {
    const answer = "  I don’t Like  UNIFORMS!  ";
    const first = normalizeAnswer(answer);

    for (let index = 0; index < 5; index += 1) {
      expect(normalizeAnswer(answer)).toBe(first);
    }
    // 正規化済みの文字列を入れ直しても変わらない（べき等）
    expect(normalizeAnswer(first)).toBe(first);
  });

  it("空文字や記号だけでも落ちない", () => {
    expect(normalizeAnswer("")).toBe("");
    expect(normalizeAnswer("   ")).toBe("");
    expect(normalizeAnswer("...")).toBe("");
  });
});
