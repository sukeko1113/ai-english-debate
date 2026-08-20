import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closePool, query } from "@/lib/db/client";
import { findMaterialForLevel } from "@/lib/db/materials";
import { startLessonSession } from "@/lib/db/sessions";
import { OpenAIRequestError } from "@/lib/openai/client";

/**
 * POST /api/realtime/session のテスト。
 *
 * **ネットワークへ出さない。** OpenAI への中継は lib/openai/client をモックする。
 * 中継そのものの検証は tests/openai/client.test.ts。
 *
 * 見たいのは信頼境界（docs/REALTIME_ARCHITECTURE.md §1）:
 *   他人のセッションを弾く / 上限を超えたら止める /
 *   OpenAI のエラー本文を外へ出さない / 生 ID を OpenAI へ送らない
 */

const hasDb = Boolean(process.env.DATABASE_URL);

const STUDENT_A = "33333333-3333-4333-8333-333333333333"; // 仮認証が返す生徒
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

const createRealtimeCall = vi.hoisted(() => vi.fn());

vi.mock("@/lib/openai/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/openai/client")>();
  return { ...actual, createRealtimeCall };
});

const { POST } = await import("@/app/api/realtime/session/route");

function post(body: unknown): Request {
  return new Request("http://localhost/api/realtime/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function newSession(studentId: string): Promise<string> {
  // v03 プロンプトのフェーズを持つ教材（Club Activities / intermediate）
  const materialId = await findMaterialForLevel("intermediate");
  if (!materialId) throw new Error("教材が無い。npm run seed:content が必要");
  const session = await startLessonSession({
    studentId,
    materialId,
    rubricVersion: "v1",
    promptVersion: "v1",
  });
  return session.id;
}

describe.skipIf(!hasDb)("POST /api/realtime/session", () => {
  const env = { ...process.env };

  beforeAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
  });

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.OPENAI_REALTIME_MODEL = "test-realtime-model";
    process.env.SAFETY_ID_SALT = "test-salt";
    process.env.REALTIME_SESSIONS_PER_HOUR = "6";

    createRealtimeCall.mockReset();
    createRealtimeCall.mockResolvedValue({
      sdpAnswer: "v=0\r\no=- answer",
      callId: "rtc_test",
    });

    await query(`delete from realtime_calls where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  afterAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    await closePool();
  });

  it("SDP answer を application/sdp で返す", async () => {
    const sessionId = await newSession(STUDENT_A);

    const response = await POST(
      post({ lessonSessionId: sessionId, sdp: "v=0\r\no=- offer" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/sdp");
    expect(await response.text()).toBe("v=0\r\no=- answer");

    // 接続を記録している（レート制限と利用量の突き合わせに使う）
    const rows = await query<{ call_id: string; model: string }>(
      `select call_id, model from realtime_calls where student_id = $1`,
      [STUDENT_A],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.call_id).toBe("rtc_test");
    expect(rows[0]?.model).toBe("test-realtime-model");
  });

  it("教材と現在フェーズの1問を instructions に載せて送る", async () => {
    const sessionId = await newSession(STUDENT_A);

    const response = await POST(
      post({ lessonSessionId: sessionId, sdp: "v=0" }),
    );
    expect(response.status).toBe(200);

    const sent = createRealtimeCall.mock.calls[0]?.[0];
    const instructions: string = sent.session.instructions;

    // 教材が入っている（コードに埋め込まず DB から来る）
    expect(instructions).toContain("speaking against making club activities");
    // v03 S00 の最初の1問
    expect(instructions).toContain("`against` は賛成と反対のどちらですか？");
    // まだ実装していない先のフェーズを混ぜない
    expect(instructions).not.toContain("Signpost は");
    // すぐ答えを言わせない
    expect(instructions).toContain("質問した同じターンで正解を言わない");

    // 点数を扱う tool を渡さない（CLAUDE.md 禁止事項2）
    expect(sent.session.tools).toBeUndefined();
  });

  it("現在フェーズをアプリ側に保存する。モデルの記憶に依存しない", async () => {
    const sessionId = await newSession(STUDENT_A);
    // 未接続の状態から始める。同じセッションを使い回す他のテストに依存しない
    await query(
      `update lesson_sessions set current_phase = null where id = $1`,
      [sessionId],
    );

    const before = await query<{ current_phase: string | null }>(
      `select current_phase from lesson_sessions where id = $1`,
      [sessionId],
    );
    expect(before[0]?.current_phase).toBeNull();

    await POST(post({ lessonSessionId: sessionId, sdp: "v=0" }));

    const after = await query<{ current_phase: string | null }>(
      `select current_phase from lesson_sessions where id = $1`,
      [sessionId],
    );
    expect(after[0]?.current_phase).toBe("S00_START");
  });

  it("保存済みのフェーズから再開する", async () => {
    const sessionId = await newSession(STUDENT_A);
    await query(
      `update lesson_sessions set current_phase = 'S10_OPENING' where id = $1`,
      [sessionId],
    );

    await POST(post({ lessonSessionId: sessionId, sdp: "v=0" }));

    const instructions: string =
      createRealtimeCall.mock.calls[0]?.[0].session.instructions;
    expect(instructions).toContain("`optional` は");
    expect(instructions).not.toContain("`against` は賛成と反対のどちらですか？");
  });

  it("生の student_id を OpenAI へ送らない", async () => {
    const sessionId = await newSession(STUDENT_A);
    await POST(post({ lessonSessionId: sessionId, sdp: "v=0" }));

    const args = createRealtimeCall.mock.calls[0]?.[0];
    expect(args.safetyId).not.toBe(STUDENT_A);
    expect(args.safetyId).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain(STUDENT_A);
  });

  it("他人のセッションは 404。OpenAI を呼ばない", async () => {
    const foreign = await newSession(STUDENT_B);

    const response = await POST(post({ lessonSessionId: foreign, sdp: "v=0" }));

    expect(response.status).toBe(404);
    expect(createRealtimeCall).not.toHaveBeenCalled();
  });

  it("sdp が無ければ 400", async () => {
    const sessionId = await newSession(STUDENT_A);

    const response = await POST(post({ lessonSessionId: sessionId }));

    expect(response.status).toBe(400);
    expect(createRealtimeCall).not.toHaveBeenCalled();
  });

  it("1時間の上限を超えたら 429。OpenAI を呼ばない", async () => {
    const sessionId = await newSession(STUDENT_A);
    process.env.REALTIME_SESSIONS_PER_HOUR = "2";

    for (let i = 0; i < 2; i += 1) {
      const ok = await POST(post({ lessonSessionId: sessionId, sdp: "v=0" }));
      expect(ok.status).toBe(200);
    }
    createRealtimeCall.mockClear();

    const blocked = await POST(
      post({ lessonSessionId: sessionId, sdp: "v=0" }),
    );

    expect(blocked.status).toBe(429);
    expect(createRealtimeCall).not.toHaveBeenCalled();
  });

  it("OpenAI のエラー本文をクライアントへ返さない", async () => {
    const sessionId = await newSession(STUDENT_A);
    createRealtimeCall.mockRejectedValue(
      new OpenAIRequestError(400, "invalid_model: secret-model-name"),
    );

    const response = await POST(
      post({ lessonSessionId: sessionId, sdp: "v=0" }),
    );
    const raw = await response.text();

    expect(response.status).toBe(502);
    expect(raw).not.toContain("secret-model-name");
    expect(raw).not.toContain("invalid_model");
  });

  it("APIキーが無いときも鍵の値を漏らさない", async () => {
    const sessionId = await newSession(STUDENT_A);
    delete process.env.OPENAI_REALTIME_MODEL;

    const response = await POST(
      post({ lessonSessionId: sessionId, sdp: "v=0" }),
    );
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(raw).not.toContain("sk-test-key");
  });
});
