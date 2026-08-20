import { describe, expect, it } from "vitest";

import type { RubricAxis } from "@/lib/db/scoring";
import {
  SCORER_INSTRUCTIONS,
  buildScorerInput,
  parseScorerOutput,
  scorableAxes,
} from "@/lib/scoring/model";

/**
 * モデル採点の組み立てと検証（docs/RUBRIC.md「モデル採点」）。
 * **採点器の出力を信用しない。**
 */

const rubric: RubricAxis[] = [
  {
    axis: "reasoning",
    maxScore: 20,
    scorerKind: "model",
    descriptors: { full_marks: "理由を2つ述べられる" },
  },
  {
    axis: "claim",
    maxScore: 10,
    scorerKind: "model",
    descriptors: { full_marks: "立場が明確" },
  },
  {
    axis: "speaking",
    maxScore: 15,
    scorerKind: "record_only",
    descriptors: { full_marks: "MVP では採点しない" },
  },
  {
    axis: "language_accuracy",
    maxScore: 20,
    scorerKind: "deterministic",
    descriptors: {},
  },
];

const axes = scorableAxes(rubric);

describe("採点する軸の選択", () => {
  it("model の軸だけを採点対象にする", () => {
    // record_only（Speaking）と deterministic は除く
    expect(axes.map((axis) => axis.axis)).toEqual(["reasoning", "claim"]);
  });
});

describe("採点器への入力", () => {
  it("教材・答案・書き起こしを渡す", () => {
    const input = JSON.parse(
      buildScorerInput({
        rubricVersion: "v1",
        level: "intermediate",
        topicTitle: "Making Club Activities Optional",
        script: "Good morning.",
        axes: axes.map((axis) => ({
          axis: axis.axis,
          maxScore: axis.maxScore,
          descriptor: String(axis.descriptors.full_marks),
        })),
        answers: [
          {
            questionKey: "dict-1",
            questionPrompt: "Listen and write.",
            answerText: "hello",
            attemptNo: 1,
          },
        ],
        transcript: [
          { speaker: "student", text: "反対です", startedAtMs: 1000 },
        ],
      }),
    );

    expect(input.rubric_version).toBe("v1");
    expect(input.axes).toHaveLength(2);
    expect(input.answers[0].answer_text).toBe("hello");
    expect(input.transcript[0].speaker).toBe("student");
  });

  it("指示に「JSON だけ」「根拠必須」が入っている", () => {
    expect(SCORER_INSTRUCTIONS).toContain("Return JSON only");
    expect(SCORER_INSTRUCTIONS).toContain("`evidence` is required");
  });
});

describe("採点器の出力の取り込み", () => {
  const output = (payload: unknown) => JSON.stringify(payload);

  it("正しい出力を取り込む", () => {
    const parsed = parseScorerOutput(
      output({
        axes: [
          { axis: "reasoning", raw_score: 14, evidence: ["理由が2つある"] },
          { axis: "claim", raw_score: 8, evidence: ["立場が明確"] },
        ],
        feedback: { good_points: ["よい"], next_goal: "次はこれ" },
      }),
      axes,
    );

    expect(parsed?.scores).toHaveLength(2);
    expect(parsed?.scores[0]).toEqual({
      axis: "reasoning",
      rawScore: 14,
      maxScore: 20,
      evidence: ["理由が2つある"],
    });
    expect(parsed?.feedback?.nextGoal).toBe("次はこれ");
  });

  it("根拠の無い軸は捨てる", () => {
    // docs/RUBRIC.md「evidence を必須にする」
    const parsed = parseScorerOutput(
      output({
        axes: [
          { axis: "reasoning", raw_score: 20, evidence: [] },
          { axis: "claim", raw_score: 8, evidence: ["立場が明確"] },
        ],
      }),
      axes,
    );

    expect(parsed?.scores.map((score) => score.axis)).toEqual(["claim"]);
  });

  it("満点を超える点数は捨てる", () => {
    const parsed = parseScorerOutput(
      output({
        axes: [{ axis: "reasoning", raw_score: 21, evidence: ["根拠"] }],
      }),
      axes,
    );

    expect(parsed?.scores).toHaveLength(0);
  });

  it("知らない軸は捨てる", () => {
    const parsed = parseScorerOutput(
      output({
        axes: [
          { axis: "speaking", raw_score: 15, evidence: ["発音がよい"] },
          { axis: "総合", raw_score: 100, evidence: ["すばらしい"] },
        ],
      }),
      axes,
    );

    // MVP で採点しない Speaking を、モデルに勝手に採点させない
    expect(parsed?.scores).toHaveLength(0);
  });

  it("負の点数は捨てる", () => {
    const parsed = parseScorerOutput(
      output({ axes: [{ axis: "claim", raw_score: -5, evidence: ["x"] }] }),
      axes,
    );
    expect(parsed?.scores).toHaveLength(0);
  });

  it("JSON でない出力は null", () => {
    expect(parseScorerOutput("採点しました！ reasoning は 14 点です", axes)).toBeNull();
    expect(parseScorerOutput(output({ no: "axes" }), axes)).toBeNull();
  });
});
