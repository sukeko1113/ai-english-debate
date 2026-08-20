import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closePool, query } from "@/lib/db/client";
import { findMaterialId, getQuestionsWithAnswers } from "@/lib/db/materials";
import { recordAnswer } from "@/lib/db/answers";
import { startLessonSession } from "@/lib/db/sessions";
import { appendTranscript } from "@/lib/db/transcript";

/**
 * POST /finish と GET /result（docs/RUBRIC.md「採点の実行タイミング」）。
 *
 * **モデル採点はネットワークへ出さない。** lib/openai/client の
 * createScoringCompletion をモックする。
 *
 * いちばん見たいのは「モデル採点が失敗しても確定採点の結果は残る」こと。
 */

const hasDb = Boolean(process.env.DATABASE_URL);

const STUDENT_A = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

const createScoringCompletion = vi.hoisted(() => vi.fn());

vi.mock("@/lib/openai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openai/client")>();
  return { ...actual, createScoringCompletion };
});

const { POST: finish } = await import(
  "@/app/api/lesson-sessions/[id]/finish/route"
);
const { GET: result } = await import(
  "@/app/api/lesson-sessions/[id]/result/route"
);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(): Request {
  return new Request("http://localhost/api/lesson-sessions/x/finish", {
    method: "POST",
  });
}

describe.skipIf(!hasDb)("授業の終了と採点", () => {
  let sessionId = "";
  let foreignSessionId = "";
  let materialId = "";

  const env = { ...process.env };

  beforeAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);

    // ディクテーションを持つ教材で採点する
    const id = await findMaterialId("school-uniforms", "beginner");
    if (!id) throw new Error("教材が無い。npm run seed:content が必要");
    materialId = id;
  });

  beforeEach(async () => {
    process.env.SCORER_MODEL = "test-scorer";
    process.env.SCORER_PROMPT_VERSION = "v1";
    process.env.OPENAI_API_KEY = "sk-test";
    createScoringCompletion.mockReset();

    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);

    sessionId = (
      await startLessonSession({
        studentId: STUDENT_A,
        materialId,
        rubricVersion: "v1",
        promptVersion: "v1",
      })
    ).id;
    foreignSessionId = (
      await startLessonSession({
        studentId: STUDENT_B,
        materialId,
        rubricVersion: "v1",
        promptVersion: "v1",
      })
    ).id;

    // ディクテーション1問に正解、1問に誤答を入れる
    const questions = await getQuestionsWithAnswers(materialId);
    const dictations = questions.filter((q) => q.type === "dictation");
    const first = dictations[0];
    const second = dictations[1];
    if (!first?.answer || !second?.answer) throw new Error("教材が想定と違う");

    await recordAnswer({
      sessionId,
      questionId: first.id,
      attemptNo: 1,
      answerText: first.answer.toUpperCase(),
    });
    await recordAnswer({
      sessionId,
      questionId: second.id,
      attemptNo: 1,
      answerText: "completely wrong",
    });

    await appendTranscript(sessionId, [
      { speaker: "tutor", text: "Why do you think so?", startedAtMs: 1000 },
      { speaker: "student", text: "Because it is easy.", startedAtMs: 4000 },
    ]);
  });

  afterAll(async () => {
    process.env = { ...env };
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    await closePool();
  });

  it("確定採点とモデル採点が別の run として残る", async () => {
    createScoringCompletion.mockResolvedValue(
      JSON.stringify({
        axes: [
          { axis: "reasoning", raw_score: 14, evidence: ["理由が1つ"] },
          { axis: "claim", raw_score: 8, evidence: ["立場が明確"] },
        ],
        feedback: { good_points: ["because が使えた"], next_goal: "理由を2つ" },
      }),
    );

    const response = await finish(request(), params(sessionId));
    expect(response.status).toBe(200);

    const runs = await query<{ scorer_kind: string; is_current: boolean }>(
      `select scorer_kind, is_current from scoring_runs where session_id = $1
        order by scorer_kind`,
      [sessionId],
    );
    expect(runs.map((run) => run.scorer_kind)).toEqual([
      "deterministic",
      "model",
    ]);
    expect(runs.every((run) => run.is_current)).toBe(true);
  });

  it("モデル採点が失敗しても確定採点は残る", async () => {
    createScoringCompletion.mockRejectedValue(new Error("scorer is down"));

    const response = await finish(request(), params(sessionId));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.deterministic).toBe(true);
    expect(body.modelScored).toBe(false);

    // docs/RUBRIC.md「モデル採点が失敗しても、確定採点の結果は残ること」
    const scores = await query<{ axis: string }>(
      `select s.axis from scoring_runs r join scores s on s.scoring_run_id = r.id
        where r.session_id = $1`,
      [sessionId],
    );
    expect(scores.map((score) => score.axis)).toEqual(["language_accuracy"]);

    // 授業は終了扱いになる
    const rows = await query<{ status: string }>(
      `select status from lesson_sessions where id = $1`,
      [sessionId],
    );
    expect(rows[0]?.status).toBe("finished");
  });

  it("採点器が散文を返しても採用しない", async () => {
    createScoringCompletion.mockResolvedValue("だいたい14点くらいです");

    await finish(request(), params(sessionId));

    const runs = await query<{ scorer_kind: string }>(
      `select scorer_kind from scoring_runs where session_id = $1`,
      [sessionId],
    );
    expect(runs.map((run) => run.scorer_kind)).toEqual(["deterministic"]);
  });

  it("満点は 85 点。Speaking を合計に入れない", async () => {
    createScoringCompletion.mockResolvedValue(
      JSON.stringify({
        axes: [{ axis: "reasoning", raw_score: 14, evidence: ["理由"] }],
      }),
    );
    await finish(request(), params(sessionId));

    const response = await result(
      new Request("http://localhost/x"),
      params(sessionId),
    );
    const body = await response.json();

    expect(body.status).toBe("finished");
    // 100 - 15（Speaking）= 85。rubrics テーブルから出している
    expect(body.maxScore).toBe(85);
    expect(body.notScored).toEqual(["speaking"]);
    expect(body.axes.find((a: { axis: string }) => a.axis === "speaking")).toBeUndefined();
  });

  it("ディクテーションの出来が点数に出る", async () => {
    createScoringCompletion.mockRejectedValue(new Error("skip"));
    await finish(request(), params(sessionId));

    const response = await result(
      new Request("http://localhost/x"),
      params(sessionId),
    );
    const body = await response.json();

    const accuracy = body.axes.find(
      (axis: { axis: string }) => axis.axis === "language_accuracy",
    );
    // 3問中1問正解（大文字でも正解）→ 確定分10点のうち 3点
    expect(accuracy.score).toBe(3);
    // ルーブリック上は20点だが、今回採点できたのは確定分の10点だけ
    expect(accuracy.max).toBe(20);
    expect(accuracy.assessedMax).toBe(10);
    // 生徒に見せる分母は「採点できた配点」の側
    expect(body.assessedMaxScore).toBe(10);
    expect(body.maxScore).toBe(85);
  });

  it("教員修正が最終成績に反映される", async () => {
    createScoringCompletion.mockRejectedValue(new Error("skip"));
    await finish(request(), params(sessionId));

    const runs = await query<{ id: string }>(
      `select id from scoring_runs where session_id = $1 limit 1`,
      [sessionId],
    );
    await query(
      `insert into score_overrides
         (scoring_run_id, axis, teacher_id, new_score, reason)
       values ($1, 'language_accuracy',
               '22222222-2222-4222-8222-222222222222', 9, '聞き取りは正確だった')`,
      [runs[0]?.id],
    );

    const response = await result(
      new Request("http://localhost/x"),
      params(sessionId),
    );
    const body = await response.json();
    const accuracy = body.axes.find(
      (axis: { axis: string }) => axis.axis === "language_accuracy",
    );

    // 元の scores は書き換えず、上書きを適用した結果を返す
    expect(accuracy.score).toBe(9);
  });

  it("採点中は点数を返さない", async () => {
    await query(`update lesson_sessions set status = 'scoring' where id = $1`, [
      sessionId,
    ]);

    const response = await result(
      new Request("http://localhost/x"),
      params(sessionId),
    );
    const body = await response.json();

    expect(body.status).toBe("scoring");
    expect(body.totalScore).toBeUndefined();
  });

  it("他人のセッションは 404", async () => {
    expect(
      (await finish(request(), params(foreignSessionId))).status,
    ).toBe(404);
    expect(
      (await result(new Request("http://localhost/x"), params(foreignSessionId)))
        .status,
    ).toBe(404);
  });
});
