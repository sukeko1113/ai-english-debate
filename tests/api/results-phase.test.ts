import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/results/phase/route";
import { closePool, query } from "@/lib/db/client";
import { findMaterialForLevel, findMaterialId } from "@/lib/db/materials";
import { startLessonSession } from "@/lib/db/sessions";

/**
 * POST /api/results/phase のテスト。
 *
 * 進行を決めるのはアプリで、モデルではない
 * （docs/LESSON_FLOW.md「ステップ遷移の実装」）。
 *
 * もう1つ大事なのは **レスポンスに instructions を含めないこと**。
 * v03 のフェーズ instructions には受理する答えとヒントが入っており、
 * ブラウザへ返すと生徒が正解を読める（docs/SECURITY.md §2）。
 */

const hasDb = Boolean(process.env.DATABASE_URL);

const STUDENT_A = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

function post(lessonSessionId: string, phaseId: unknown): Request {
  return new Request("http://localhost/api/results/phase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonSessionId, args: { phase_id: phaseId } }),
  });
}

describe.skipIf(!hasDb)("POST /api/results/phase", () => {
  let sessionId = "";
  let foreignSessionId = "";

  async function currentPhase(id: string): Promise<string | null> {
    const rows = await query<{ current_phase: string | null }>(
      `select current_phase from lesson_sessions where id = $1`,
      [id],
    );
    return rows[0]?.current_phase ?? null;
  }

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
    // 未接続の状態（current_phase 未設定）から始める
    await query(
      `update lesson_sessions set current_phase = null where id in ($1, $2)`,
      [sessionId, foreignSessionId],
    );
  });

  afterAll(async () => {
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    await closePool();
  });

  it("現在フェーズの完了を伝えると次へ進む", async () => {
    const response = await POST(post(sessionId, "S00_START"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      next_phase: "S10_OPENING",
    });
    expect(await currentPhase(sessionId)).toBe("S10_OPENING");
  });

  it("レスポンスに instructions も正解も含めない", async () => {
    const response = await POST(post(sessionId, "S00_START"));
    const raw = await response.text();

    expect(raw).not.toContain("instructions");
    // 受理する答え・ヒントが漏れていないこと
    expect(raw).not.toContain("ヒント");
    expect(raw).not.toContain("反対");
    expect(raw).not.toContain("optional は");
    // 返すのは進行位置だけ
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["next_phase", "ok"]);
  });

  it("食い違うフェーズを主張されても進めない", async () => {
    // モデルが飛ばそうとしても、アプリの状態は動かさない
    const response = await POST(post(sessionId, "S130_MINI_DEBATE"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      currentPhase: "S00_START",
    });
    expect(await currentPhase(sessionId)).toBeNull();
  });

  it("同じフェーズを二度完了しても飛び越さない", async () => {
    await POST(post(sessionId, "S00_START"));
    expect(await currentPhase(sessionId)).toBe("S10_OPENING");

    // すでに S10 にいるので、S00 の完了はもう受け付けない
    const again = await POST(post(sessionId, "S00_START"));
    expect(await again.json()).toEqual({
      ok: false,
      currentPhase: "S10_OPENING",
    });
    expect(await currentPhase(sessionId)).toBe("S10_OPENING");
  });

  it("最後のフェーズでは next_phase が null", async () => {
    const last = "S140_REVIEW_AND_SAVE";
    await query(
      `update lesson_sessions set current_phase = $2 where id = $1`,
      [sessionId, last],
    );

    const response = await POST(post(sessionId, last));

    expect(await response.json()).toEqual({ ok: true, next_phase: null });
    expect(await currentPhase(sessionId)).toBe(last);
  });

  it("他人のセッションは 404。進めない", async () => {
    const response = await POST(post(foreignSessionId, "S00_START"));

    expect(response.status).toBe(404);
    expect(await currentPhase(foreignSessionId)).toBeNull();
  });

  it("phase_id が無ければ 400", async () => {
    expect((await POST(post(sessionId, undefined))).status).toBe(400);
    expect((await POST(post(sessionId, 5))).status).toBe(400);
  });

  it("フェーズを持たない教材では 400", async () => {
    const materialId = await findMaterialId("school-uniforms", "beginner");
    const session = await startLessonSession({
      studentId: STUDENT_A,
      materialId: materialId!,
      rubricVersion: "v1",
      promptVersion: "v1",
    });

    const response = await POST(post(session.id, "S00_START"));
    expect(response.status).toBe(400);
  });
});
