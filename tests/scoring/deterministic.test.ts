import { describe, expect, it } from "vitest";

import {
  DICTATION_MAX_SCORE,
  scoreDictation,
  scoreDictationSet,
  selectScoredAttempt,
} from "@/lib/scoring/deterministic";

/**
 * 確定採点（docs/RUBRIC.md）。**AI を使わない。同じ入力なら同じ結果。**
 */

const EXPECTED = "Some students like uniforms because they are easy to wear.";

describe("ディクテーションの照合", () => {
  it("表記の揺れは正解にする", () => {
    expect(
      scoreDictation(
        "  some students like UNIFORMS because they are easy to wear  ",
        EXPECTED,
      ).correct,
    ).toBe(true);
  });

  it("語が違えば不正解", () => {
    expect(
      scoreDictation(
        "Some students like uniforms because they are easy to use.",
        EXPECTED,
      ).correct,
    ).toBe(false);
  });

  it("カンマの有無は区別する", () => {
    expect(
      scoreDictation(
        "Some students like uniforms, because they are easy to wear.",
        EXPECTED,
      ).correct,
    ).toBe(false);
  });

  it("無回答は正解にしない", () => {
    expect(scoreDictation("", "").correct).toBe(false);
    expect(scoreDictation("   ", EXPECTED).correct).toBe(false);
  });

  it("正規化した中身を根拠として返す", () => {
    const result = scoreDictation("Some Students Like...", EXPECTED);
    expect(result.normalized).toBe("some students like");
    expect(result.expectedNormalized).toBe(
      "some students like uniforms because they are easy to wear",
    );
  });
});

describe("ディクテーション一式の採点", () => {
  const item = (key: string, answerText: string, expected: string) => ({
    key,
    answerText,
    expected,
  });

  it("全問正解なら満点", () => {
    const score = scoreDictationSet([
      item("dict-1", "hello world", "Hello world."),
      item("dict-2", "good morning", "Good morning!"),
    ]);

    expect(score.applicable).toBe(true);
    expect(score.correct).toBe(2);
    expect(score.rawScore).toBe(DICTATION_MAX_SCORE);
    expect(score.maxScore).toBe(DICTATION_MAX_SCORE);
  });

  it("正答率に比例して配点する", () => {
    const score = scoreDictationSet([
      item("dict-1", "hello world", "Hello world."),
      item("dict-2", "wrong", "Good morning!"),
      item("dict-3", "wrong", "Good evening!"),
      item("dict-4", "good night", "Good night."),
    ]);

    expect(score.correct).toBe(2);
    expect(score.total).toBe(4);
    expect(score.rawScore).toBe(5);
  });

  it("教員が確認できる根拠を残す", () => {
    const score = scoreDictationSet([
      item("dict-1", "helo world", "Hello world."),
    ]);

    // 根拠が無いと教員は修正を判断できない（docs/DATA_MODEL.md scores.evidence）
    expect(score.evidence).toEqual([
      {
        key: "dict-1",
        correct: false,
        answered: true,
        normalized: "helo world",
        expectedNormalized: "hello world",
      },
    ]);
  });

  it("未回答は不正解として分母に数える", () => {
    // 飛ばした方が得点率が上がってはいけない
    const score = scoreDictationSet([
      item("dict-1", "hello world", "Hello world."),
      { key: "dict-2", answerText: null, expected: "Good morning." },
      { key: "dict-3", answerText: null, expected: "Good evening." },
    ]);

    expect(score.total).toBe(3);
    expect(score.correct).toBe(1);
    expect(score.rawScore).toBe(3);
    expect(score.evidence[1]).toMatchObject({ answered: false, correct: false });
  });

  it("ディクテーションが無い教材では applicable が false", () => {
    const score = scoreDictationSet([]);

    expect(score.applicable).toBe(false);
    expect(score.maxScore).toBe(0);
    expect(score.rawScore).toBe(0);
  });

  it("同じ入力なら必ず同じ結果になる", () => {
    const items = [
      item("dict-1", " Hello  WORLD. ", "hello world"),
      item("dict-2", "wrong", "Good morning"),
    ];
    const first = JSON.stringify(scoreDictationSet(items));

    for (let index = 0; index < 5; index += 1) {
      expect(JSON.stringify(scoreDictationSet(items))).toBe(first);
    }
  });
});

describe("採点する試行の選択", () => {
  const answers = [
    { questionId: "q1", attemptNo: 2, answerText: "二回目" },
    { questionId: "q1", attemptNo: 1, answerText: "一回目" },
    { questionId: "q2", attemptNo: 1, answerText: "別の問題" },
  ];

  it("最初の試行を選ぶ", () => {
    expect(selectScoredAttempt(answers, "q1")?.answerText).toBe("一回目");
  });

  it("答案が無ければ null", () => {
    expect(selectScoredAttempt(answers, "q3")).toBeNull();
  });
});
