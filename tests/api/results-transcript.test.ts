import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/results/transcript/route";
import { closePool, query } from "@/lib/db/client";
import { findMaterialForLevel } from "@/lib/db/materials";
import { startLessonSession } from "@/lib/db/sessions";
import { getTranscript } from "@/lib/db/transcript";

/**
 * POST /api/results/transcript のテスト。
 *
 * 書き起こしもブラウザ経由なので改ざんされうる
 * （docs/REALTIME_ARCHITECTURE.md §6）。検証できるところを検証する。
 */

const hasDb = Boolean(process.env.DATABASE_URL);

const STUDENT_A = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

function post(lessonSessionId: string, items: unknown): Request {
  return new Request("http://localhost/api/results/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonSessionId, items }),
  });
}

describe.skipIf(!hasDb)("POST /api/results/transcript", () => {
  let sessionId = "";
  let foreignSessionId = "";

  beforeAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);

    const materialId = await findMaterialForLevel("intermediate");
    if (!materialId) throw new Error("教材が無い。npm run seed:content が必要");

    sessionId = (
      await startLessonSession({
        studentId: STUDENT_A,
        materialId,
        rubricVersion: "v1",
        promptVersion: "v03-club-activities",
      })
    ).id;
    foreignSessionId = (
      await startLessonSession({
        studentId: STUDENT_B,
        materialId,
        rubricVersion: "v1",
        promptVersion: "v03-club-activities",
      })
    ).id;
  });

  beforeEach(async () => {
    await query(`delete from session_transcript where session_id in ($1, $2)`, [
      sessionId,
      foreignSessionId,
    ]);
  });

  afterAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    await closePool();
  });

  it("バッチで保存し、クライアントの seq の順に並べる", async () => {
    const response = await POST(
      post(sessionId, [
        { seq: 2, speaker: "student", text: "反対です", startedAtMs: 5200 },
        { seq: 1, speaker: "tutor", text: "against は？", startedAtMs: 1200 },
      ]),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, saved: 2 });

    const lines = await getTranscript(sessionId);
    expect(lines.map((line) => line.text)).toEqual([
      "against は？",
      "反対です",
    ]);
    expect(lines.map((line) => line.speaker)).toEqual(["tutor", "student"]);
    expect(lines[0]?.startedAtMs).toBe(1200);
  });

  it("seq はサーバーが採番する。再接続で振り出しに戻っても消えない", async () => {
    await POST(
      post(sessionId, [
        { seq: 1, speaker: "tutor", text: "1回目の接続", startedAtMs: 100 },
      ]),
    );
    // 再接続でブラウザの採番が 1 に戻ったとみなす
    await POST(
      post(sessionId, [
        { seq: 1, speaker: "student", text: "2回目の接続", startedAtMs: 200 },
      ]),
    );

    const lines = await getTranscript(sessionId);
    expect(lines.map((line) => line.text)).toEqual([
      "1回目の接続",
      "2回目の接続",
    ]);
    // seq は重複しない
    expect(new Set(lines.map((line) => line.seq)).size).toBe(2);
  });

  it("他人のセッションは 404。保存しない", async () => {
    const response = await POST(
      post(foreignSessionId, [
        { seq: 1, speaker: "tutor", text: "x", startedAtMs: 0 },
      ]),
    );

    expect(response.status).toBe(404);
    expect(await getTranscript(foreignSessionId)).toHaveLength(0);
  });

  it("speaker は student / tutor のみ", async () => {
    const response = await POST(
      post(sessionId, [
        { seq: 1, speaker: "system", text: "x", startedAtMs: 0 },
      ]),
    );

    expect(response.status).toBe(400);
    expect(await getTranscript(sessionId)).toHaveLength(0);
  });

  it("壊れた items は 400。1件でも駄目なら全部保存しない", async () => {
    const cases: unknown[][] = [
      [{ seq: 1, speaker: "tutor", text: "", startedAtMs: 0 }],
      [{ seq: 1, speaker: "tutor", text: "x", startedAtMs: -1 }],
      [{ seq: 1, speaker: "tutor", text: "x" }],
      [{ seq: 1, speaker: "tutor", text: "a".repeat(5001), startedAtMs: 0 }],
      [
        { seq: 1, speaker: "tutor", text: "正しい行", startedAtMs: 0 },
        { seq: 2, speaker: "tutor", startedAtMs: 0 },
      ],
    ];

    for (const items of cases) {
      const response = await POST(post(sessionId, items));
      expect(response.status, JSON.stringify(items)).toBe(400);
    }
    expect(await getTranscript(sessionId)).toHaveLength(0);
  });

  it("件数が多すぎると 400", async () => {
    const items = Array.from({ length: 51 }, (_unused, index) => ({
      seq: index,
      speaker: "tutor",
      text: "x",
      startedAtMs: index,
    }));

    expect((await POST(post(sessionId, items))).status).toBe(400);
  });

  it("空の items は保存せずに成功", async () => {
    const response = await POST(post(sessionId, []));
    expect(await response.json()).toEqual({ ok: true, saved: 0 });
  });
});
