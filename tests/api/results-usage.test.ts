import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/results/usage/route";
import { closePool, query } from "@/lib/db/client";
import { findMaterialForLevel } from "@/lib/db/materials";
import { recordRealtimeCall } from "@/lib/db/realtime";
import { startLessonSession } from "@/lib/db/sessions";
import { getSessionUsage } from "@/lib/db/usage";

/**
 * POST /api/results/usage のテスト。
 * 記録する項目は docs/REALTIME_ARCHITECTURE.md §8。
 */

const hasDb = Boolean(process.env.DATABASE_URL);

const STUDENT_A = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

function post(body: unknown): Request {
  return new Request("http://localhost/api/results/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasDb)("POST /api/results/usage", () => {
  let sessionId = "";
  let foreignSessionId = "";
  let neverConnectedId = "";

  beforeAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);

    const materialId = await findMaterialForLevel("intermediate");
    if (!materialId) throw new Error("教材が無い。npm run seed:content が必要");

    const make = async (studentId: string) =>
      (
        await startLessonSession({
          studentId,
          materialId,
          rubricVersion: "v1",
          promptVersion: "v03-club-activities",
        })
      ).id;

    sessionId = await make(STUDENT_A);
    foreignSessionId = await make(STUDENT_B);

    // 接続済みにする（/api/realtime/session が入れる行と同じもの）
    await recordRealtimeCall({
      sessionId,
      studentId: STUDENT_A,
      callId: "rtc_test",
      model: "server-side-model",
    });
    await recordRealtimeCall({
      sessionId: foreignSessionId,
      studentId: STUDENT_B,
      callId: "rtc_test_b",
      model: "server-side-model",
    });

    // 一度も接続していないセッション
    await query(
      `insert into lesson_sessions
         (id, student_id, material_id, rubric_version, prompt_version)
       values (gen_random_uuid(), $1, $2, 'v1', 'v1')
       returning id`,
      [STUDENT_A, materialId],
    );
    const rows = await query<{ id: string }>(
      `select ls.id from lesson_sessions ls
        where ls.student_id = $1
          and not exists (
            select 1 from realtime_calls rc where rc.session_id = ls.id
          )
        limit 1`,
      [STUDENT_A],
    );
    neverConnectedId = rows[0]?.id ?? "";
  });

  beforeEach(async () => {
    await query(`delete from session_usage where session_id = $1`, [sessionId]);
  });

  afterAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    await closePool();
  });

  it("トークン数を記録する", async () => {
    const response = await POST(
      post({
        lessonSessionId: sessionId,
        audioInputTokens: 1200,
        audioOutputTokens: 3400,
        textInputTokens: 80,
        textOutputTokens: 40,
      }),
    );

    expect(response.status).toBe(200);

    const usage = await getSessionUsage(sessionId);
    expect(usage?.audioInputTokens).toBe(1200);
    expect(usage?.audioOutputTokens).toBe(3400);
    expect(usage?.textInputTokens).toBe(80);
    expect(usage?.textOutputTokens).toBe(40);
  });

  it("応答ごとの差分を足し込む", async () => {
    await POST(
      post({ lessonSessionId: sessionId, audioInputTokens: 100 }),
    );
    await POST(
      post({ lessonSessionId: sessionId, audioInputTokens: 250 }),
    );

    const usage = await getSessionUsage(sessionId);
    expect(usage?.audioInputTokens).toBe(350);
  });

  it("モデル名はブラウザの申告ではなくサーバーの記録を使う", async () => {
    await POST(
      post({
        lessonSessionId: sessionId,
        model: "cheap-model-claimed-by-browser",
        audioInputTokens: 10,
      }),
    );

    // 費用計算に直結するので、接続時に記録した値を使う
    const usage = await getSessionUsage(sessionId);
    expect(usage?.model).toBe("server-side-model");
  });

  it("単価が未設定のモデルでは費用を空のままにする", async () => {
    await POST(post({ lessonSessionId: sessionId, audioInputTokens: 10 }));

    // 「0円だった」と「まだ分からない」は別物
    const usage = await getSessionUsage(sessionId);
    expect(usage?.estimatedCostUsd).toBeNull();
  });

  it("接続時間はサーバーの時計で入る", async () => {
    await POST(post({ lessonSessionId: sessionId, audioInputTokens: 10 }));

    const usage = await getSessionUsage(sessionId);
    expect(usage?.connectedSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(usage?.connectedSeconds)).toBe(true);
  });

  it("他人のセッションは 404。記録しない", async () => {
    const response = await POST(
      post({ lessonSessionId: foreignSessionId, audioInputTokens: 999 }),
    );

    expect(response.status).toBe(404);
    expect(await getSessionUsage(foreignSessionId)).toBeNull();
  });

  it("一度も接続していないセッションは 409", async () => {
    expect(neverConnectedId).not.toBe("");
    const response = await POST(
      post({ lessonSessionId: neverConnectedId, audioInputTokens: 10 }),
    );

    expect(response.status).toBe(409);
  });

  it("桁違いや負のトークン数は 400", async () => {
    const cases = [
      { audioInputTokens: -1 },
      { audioInputTokens: 1_000_001 },
      { audioInputTokens: "たくさん" },
    ];

    for (const extra of cases) {
      const response = await POST(post({ lessonSessionId: sessionId, ...extra }));
      expect(response.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await getSessionUsage(sessionId)).toBeNull();
  });

  it("Infinity を送りつけても 400", async () => {
    // JSON.stringify(Infinity) は null になってしまうので、生の本文で送る。
    // JSON.parse("1e999") は Infinity になる
    const request = new Request("http://localhost/api/results/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `{"lessonSessionId":"${sessionId}","audioInputTokens":1e999}`,
    });

    expect((await POST(request)).status).toBe(400);
    expect(await getSessionUsage(sessionId)).toBeNull();
  });

  it("欠けている項目は 0 として扱う（部分的な報告を許す）", async () => {
    const response = await POST(
      post({ lessonSessionId: sessionId, audioOutputTokens: 42 }),
    );

    expect(response.status).toBe(200);
    const usage = await getSessionUsage(sessionId);
    expect(usage?.audioOutputTokens).toBe(42);
    expect(usage?.audioInputTokens).toBe(0);
  });
});
