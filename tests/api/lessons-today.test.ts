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

// 開発用の生徒A は intermediate なので Club Activities が今日の教材になる
// （supabase/seeds/dev_seed.sql と lib/db/materials.ts findMaterialForLevel）
const STUDENT_LEVEL = "intermediate";

// content/club-activities/against-intermediate.json の受理する答え。
// これが出てきたらブラウザへ正解を送っている
const ACCEPTED_ANSWER = "クラブ活動を任意にすること";

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
    expect(body.topic.titleEn).toBe("Making Club Activities Optional");
    expect(body.level).toBe(STUDENT_LEVEL);
    expect(body.script).toContain("speaking against making club activities");
    expect(body.vocabulary.length).toBeGreaterThan(0);
    expect(body.grammarPoints.length).toBeGreaterThan(0);
  });

  it("questions に answer を含めない", async () => {
    const response = await GET();
    const body = await response.json();

    for (const question of body.questions) {
      expect(Object.keys(question)).not.toContain("answer");
      expect(Object.keys(question)).not.toContain("answerNote");
    }
  });

  it("授業フェーズに質問文・受理する答え・ヒントを含めない", async () => {
    const response = await GET();
    const body = await response.json();

    // 進行の目安と「いま読んでいる文」は出すが、中身（正解）は出さない
    expect(body.phases.length).toBeGreaterThan(0);
    for (const phase of body.phases) {
      expect(Object.keys(phase).sort()).toEqual([
        "focusSentence",
        "id",
        "itemKeys",
        "labelJa",
        "section",
      ]);

      // itemKeys は questions.key の一覧。**正解そのものは入らない**
      for (const key of phase.itemKeys) {
        expect(key).toMatch(/^[a-z0-9-]+$/);
      }

      // focusSentence は画面のハイライト用。本文の一文か、
      // S80_LOGIC_CHECK のようにセクション名を並べた見出しになる。
      // どちらにしても**正解は含めない**
      expect(phase.focusSentence).not.toContain(ACCEPTED_ANSWER);
    }
  });

  it("レスポンス全体に教材の正解が含まれない", async () => {
    const response = await GET();
    const raw = JSON.stringify(await response.json());

    expect(raw).not.toContain(ACCEPTED_ANSWER);
    expect(raw).not.toContain("ヒント");
    expect(raw).not.toContain("accept");
    // 模範解答・教員向けメモも出さない
    expect(raw).not.toContain("modelAnswers");
    expect(raw).not.toContain("teacherNote");
  });

  it("未完了のセッションがあれば existingSessionId を返す", async () => {
    const before = await GET();
    expect((await before.json()).existingSessionId).toBeNull();

    const materialId = await findMaterialForLevel(STUDENT_LEVEL);
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
