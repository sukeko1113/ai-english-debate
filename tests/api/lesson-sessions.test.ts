import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/lesson-sessions/route";
import { closePool, query } from "@/lib/db/client";
import { findMaterialForLevel } from "@/lib/db/materials";

/**
 * POST /api/lesson-sessions のテスト。
 * 仕様は docs/API_SPEC.md「POST /api/lesson-sessions」。
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const DEV_STUDENT_ID = "33333333-3333-4333-8333-333333333333";

function post(body: unknown): Request {
  return new Request("http://localhost/api/lesson-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasDb)("POST /api/lesson-sessions", () => {
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

  async function materialId(): Promise<string> {
    const id = await findMaterialForLevel("beginner");
    if (!id) throw new Error("教材が無い。npm run seed:content を実行すること");
    return id;
  }

  it("セッションを作り、教材の rubric_version を固定する", async () => {
    const response = await POST(post({ materialId: await materialId() }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.lessonSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.currentStep).toBe(1);
    // materials.rubric_version（content JSON 由来）が固定される
    expect(body.rubricVersion).toBe("v1");
  });

  it("未完了のセッションがあれば作り直さない", async () => {
    const id = await materialId();
    const first = await (await POST(post({ materialId: id }))).json();
    const second = await (await POST(post({ materialId: id }))).json();

    expect(second.lessonSessionId).toBe(first.lessonSessionId);
  });

  it("存在しない materialId は 404", async () => {
    const response = await POST(
      post({ materialId: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(response.status).toBe(404);
  });

  it("materialId が UUID でなくても 500 にしない", async () => {
    const response = await POST(post({ materialId: "not-a-uuid" }));
    expect(response.status).toBe(404);
  });

  it("materialId が無ければ 400", async () => {
    const response = await POST(post({}));
    expect(response.status).toBe(400);
  });
});
