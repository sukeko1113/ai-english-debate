import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/lessons/today/route";
import { closePool, query } from "@/lib/db/client";
import { findMaterialForLevel } from "@/lib/db/materials";
import { startLessonSession } from "@/lib/db/sessions";

/**
 * GET /api/lessons/today のテスト。
 *
 * いちばん見たいのは「正解がブラウザへ出ていないこと」
 * （docs/API_SPEC.md / docs/SECURITY.md §2）。
 *
 *   npm run db:local && npm run seed:content
 *   DATABASE_URL=... npm run test
 */

const hasDb = Boolean(process.env.DATABASE_URL);

// dev_seed.sql の架空の生徒A。lib/auth/student.ts の仮実装が返す生徒
const DEV_STUDENT_ID = "33333333-3333-4333-8333-333333333333";

// content/school-uniforms/beginner.json の dict-1 の正解
const DICTATION_ANSWER =
  "Some students like uniforms because they are easy to wear.";

describe.skipIf(!hasDb)("GET /api/lessons/today", () => {
  // 前回の実行や手動確認で残ったセッションに影響されないよう、開始前に消す
  beforeAll(async () => {
    await query(`delete from lesson_sessions where student_id = $1`, [
      DEV_STUDENT_ID,
    ]);
  });

  afterAll(async () => {
    await query(`delete from lesson_sessions where student_id = $1`, [
      DEV_STUDENT_ID,
    ]);
    await closePool();
  });

  it("今日の教材を返す", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.topic.titleEn).toBe("School Uniforms");
    expect(body.level).toBe("beginner");
    expect(body.script).toContain("School uniforms");
    expect(body.vocabulary).toHaveLength(5);
    expect(body.grammarPoints).toHaveLength(3);
    expect(body.questions).toHaveLength(7);
  });

  it("questions に answer を含めない", async () => {
    const response = await GET();
    const body = await response.json();

    for (const question of body.questions) {
      expect(Object.keys(question)).not.toContain("answer");
      expect(Object.keys(question)).not.toContain("answerNote");
    }
  });

  it("レスポンス全体に教材の正解が含まれない", async () => {
    const response = await GET();
    const raw = JSON.stringify(await response.json());

    expect(raw).not.toContain(DICTATION_ANSWER);
    // 模範解答・教員向けメモも出さない
    expect(raw).not.toContain("modelAnswers");
    expect(raw).not.toContain("teacherNote");
  });

  it("未完了のセッションがあれば existingSessionId を返す", async () => {
    const before = await GET();
    expect((await before.json()).existingSessionId).toBeNull();

    const materialId = await findMaterialForLevel("beginner");
    expect(materialId).not.toBeNull();

    const session = await startLessonSession({
      studentId: DEV_STUDENT_ID,
      materialId: materialId!,
      rubricVersion: "v1",
      promptVersion: "v1",
    });

    const after = await GET();
    expect((await after.json()).existingSessionId).toBe(session.id);
  });
});
