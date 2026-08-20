import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/results/answer/route";
import { closePool, query } from "@/lib/db/client";
import { findMaterialId, getQuestionsWithAnswers } from "@/lib/db/materials";
import { startLessonSession } from "@/lib/db/sessions";

/**
 * POST /api/results/answer のテスト。
 *
 * この API はブラウザのデータチャネルを通った値を受ける。
 * 「モデルから来た」という前提を置かず、通常のフォーム送信と同じ厳しさで
 * 検証していることを固定する（docs/REALTIME_ARCHITECTURE.md §1）。
 *
 * docs/TASKS.md Task 6 が必ずテストせよと書いている2件:
 *   - 他人の session_id を渡すと 404
 *   - 教材に属さない item_id は拒否
 */

const hasDb = Boolean(process.env.DATABASE_URL);

const STUDENT_A = "33333333-3333-4333-8333-333333333333"; // 仮認証が返す生徒
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

/** テストのためだけに別教材へ足す question。afterAll で消す */
const OTHER_QUESTION_KEY = "__test_other_material";

function post(body: unknown): Request {
  return new Request("http://localhost/api/results/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasDb)("POST /api/results/answer", () => {
  let sessionId = "";
  let foreignSessionId = "";
  let questionId = "";
  let otherMaterialQuestionId = "";

  beforeAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);

    // 記録の対象になる教材（questions を持つ）
    const materialId = await findMaterialId("school-uniforms", "beginner");
    if (!materialId) throw new Error("教材が無い。npm run seed:content が必要");

    const questions = await getQuestionsWithAnswers(materialId);
    questionId = questions[0]?.id ?? "";
    expect(questionId).not.toBe("");

    // 別教材に実在する question を用意する。
    // 「存在しない id」ではなく「存在するが別教材の id」で試さないと、
    // 教材との紐づけを検証していることにならない
    const otherMaterialId = await findMaterialId(
      "club-activities",
      "intermediate",
    );
    if (!otherMaterialId) throw new Error("別教材が無い");

    const inserted = await query<{ id: string }>(
      `insert into questions (material_id, key, ord, type, prompt, max_score)
       values ($1, $2, 999, 'comprehension', 'test only', 1)
       on conflict (material_id, key) do update set prompt = excluded.prompt
       returning id`,
      [otherMaterialId, OTHER_QUESTION_KEY],
    );
    otherMaterialQuestionId = inserted[0]?.id ?? "";
    expect(otherMaterialQuestionId).not.toBe("");

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
  });

  beforeEach(async () => {
    await query(`delete from session_answers where session_id = $1`, [
      sessionId,
    ]);
  });

  afterAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    await query(`delete from questions where key = $1`, [OTHER_QUESTION_KEY]);
    await closePool();
  });

  it("答案を保存し、{ ok: true } だけを返す", async () => {
    const response = await POST(
      post({
        lessonSessionId: sessionId,
        args: {
          item_id: questionId,
          answer_text: "Some students like uniforms becouse they are easy",
          attempt_no: 1,
        },
      }),
    );

    expect(response.status).toBe(200);
    // 正誤も点数も返さない。返すとモデルが口に出す
    expect(await response.json()).toEqual({ ok: true });

    const rows = await query<{ answer_text: string; attempt_no: number }>(
      `select answer_text, attempt_no from session_answers where session_id = $1`,
      [sessionId],
    );
    expect(rows).toHaveLength(1);
    // 生徒が言ったまま保存する。綴りを直さない
    expect(rows[0]?.answer_text).toBe(
      "Some students like uniforms becouse they are easy",
    );
  });

  it("他人の session_id を渡すと 404。保存しない", async () => {
    const response = await POST(
      post({
        lessonSessionId: foreignSessionId,
        args: { item_id: questionId, answer_text: "x", attempt_no: 1 },
      }),
    );

    expect(response.status).toBe(404);

    const rows = await query(
      `select 1 from session_answers where session_id = $1`,
      [foreignSessionId],
    );
    expect(rows).toHaveLength(0);
  });

  it("実在するが別教材の item_id は拒否する", async () => {
    const response = await POST(
      post({
        lessonSessionId: sessionId,
        args: {
          item_id: otherMaterialQuestionId,
          answer_text: "x",
          attempt_no: 1,
        },
      }),
    );

    expect(response.status).toBe(400);

    const rows = await query(
      `select 1 from session_answers where session_id = $1`,
      [sessionId],
    );
    expect(rows).toHaveLength(0);
  });

  it("同じ答案を二重に送っても行が増えない（再接続時の重複対策）", async () => {
    const body = post({
      lessonSessionId: sessionId,
      args: { item_id: questionId, answer_text: "first", attempt_no: 1 },
    });
    await POST(body);
    await POST(
      post({
        lessonSessionId: sessionId,
        args: { item_id: questionId, answer_text: "second", attempt_no: 1 },
      }),
    );

    const rows = await query<{ answer_text: string }>(
      `select answer_text from session_answers where session_id = $1`,
      [sessionId],
    );
    expect(rows).toHaveLength(1);
    // 先に記録したものを上書きしない
    expect(rows[0]?.answer_text).toBe("first");
  });

  it("点数を混ぜて送りつけても保存されない", async () => {
    const response = await POST(
      post({
        lessonSessionId: sessionId,
        args: {
          item_id: questionId,
          answer_text: "x",
          attempt_no: 1,
          // ブラウザ経由なので何でも送れる。無視されること
          score: 100,
          correct: true,
        },
      }),
    );

    expect(response.status).toBe(200);

    const columns = await query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'session_answers'`,
    );
    const names = columns.map((row) => row.column_name);
    // session_answers は採点結果を持たない（docs/DATA_MODEL.md）
    expect(names).not.toContain("score");
    expect(names).not.toContain("correct");
  });

  it("student_id をボディで渡しても認証セッションが優先される", async () => {
    const response = await POST(
      post({
        lessonSessionId: foreignSessionId,
        student_id: STUDENT_B,
        args: { item_id: questionId, answer_text: "x", attempt_no: 1 },
      }),
    );

    // STUDENT_B になりすませない。仮認証は常に STUDENT_A を返す
    expect(response.status).toBe(404);
  });

  it("壊れた引数は 400 で弾く", async () => {
    const cases = [
      { item_id: "not-a-uuid", answer_text: "x", attempt_no: 1 },
      { item_id: questionId, attempt_no: 1 },
      { item_id: questionId, answer_text: "x", attempt_no: 0 },
      { item_id: questionId, answer_text: "x", attempt_no: 1.5 },
      { item_id: questionId, answer_text: "a".repeat(2001), attempt_no: 1 },
    ];

    for (const args of cases) {
      const response = await POST(post({ lessonSessionId: sessionId, args }));
      expect(response.status, JSON.stringify(args)).toBe(400);
    }
  });
});
