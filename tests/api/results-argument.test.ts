import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/results/argument/route";
import { getArguments } from "@/lib/db/arguments";
import { closePool, query } from "@/lib/db/client";
import { findMaterialForLevel } from "@/lib/db/materials";
import { startLessonSession } from "@/lib/db/sessions";

/**
 * POST /api/results/argument のテスト。
 *
 * 授業の順序（日本語で考える → 英語にする）が記録に残ることを固定する。
 * **日本語原文を上書きしない**のが要点（docs/API_SPEC.md）。
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const STUDENT_A = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

const JA = "部員が減るとクラブがなくなってしまうから";
const EN = "If clubs become optional, many clubs will close.";

function post(lessonSessionId: string, args: unknown): Request {
  return new Request("http://localhost/api/results/argument", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonSessionId, args }),
  });
}

describe.skipIf(!hasDb)("POST /api/results/argument", () => {
  let sessionId = "";
  let foreignSessionId = "";

  beforeAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    const materialId = await findMaterialForLevel("intermediate");
    if (!materialId) throw new Error("教材が無い");

    const make = (studentId: string) =>
      startLessonSession({
        studentId,
        materialId,
        rubricVersion: "v1",
        promptVersion: "v03-club-activities",
      });

    sessionId = (await make(STUDENT_A)).id;
    foreignSessionId = (await make(STUDENT_B)).id;
  });

  beforeEach(async () => {
    await query(`delete from session_arguments where session_id = $1`, [
      sessionId,
    ]);
  });

  afterAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    await closePool();
  });

  it("日本語だけでも記録できる（S110）", async () => {
    const response = await POST(
      post(sessionId, { side: "disagree", ja_text: JA, en_text: "" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const saved = await getArguments(sessionId);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.jaText).toBe(JA);
    expect(saved[0]?.enText).toBeNull();
    expect(saved[0]?.side).toBe("disagree");
  });

  it("英語化は追記になり、日本語原文を上書きしない（S120）", async () => {
    await POST(post(sessionId, { side: "disagree", ja_text: JA }));
    await POST(post(sessionId, { side: "disagree", ja_text: JA, en_text: EN }));

    const saved = await getArguments(sessionId);
    // 行が増えない
    expect(saved).toHaveLength(1);
    // 日本語はそのまま残る
    expect(saved[0]?.jaText).toBe(JA);
    expect(saved[0]?.enText).toBe(EN);
  });

  it("英語を空で送り直しても、入っている英語を消さない", async () => {
    await POST(post(sessionId, { side: "disagree", ja_text: JA, en_text: EN }));
    await POST(post(sessionId, { side: "disagree", ja_text: JA, en_text: "" }));

    const saved = await getArguments(sessionId);
    expect(saved[0]?.enText).toBe(EN);
  });

  it("理由が2つになれば ord が振られる", async () => {
    await POST(post(sessionId, { side: "disagree", ja_text: JA }));
    await POST(
      post(sessionId, { side: "disagree", ja_text: "友達をつくる機会が減るから" }),
    );

    const saved = await getArguments(sessionId);
    expect(saved.map((entry) => entry.ord)).toEqual([1, 2]);
  });

  it("他人のセッションは 404。記録しない", async () => {
    const response = await POST(
      post(foreignSessionId, { side: "disagree", ja_text: JA }),
    );

    expect(response.status).toBe(404);
    expect(await getArguments(foreignSessionId)).toHaveLength(0);
  });

  it("壊れた引数は 400", async () => {
    const cases = [
      { side: "maybe", ja_text: JA },
      { side: "disagree", ja_text: "" },
      { side: "disagree", ja_text: "   " },
      { side: "disagree" },
      { side: "disagree", ja_text: "あ".repeat(2001) },
    ];
    for (const args of cases) {
      const response = await POST(post(sessionId, args));
      expect(response.status, JSON.stringify(args)).toBe(400);
    }
  });
});
