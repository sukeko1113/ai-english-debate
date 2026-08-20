import { afterAll, describe, expect, it } from "vitest";

import { closePool, query } from "../../lib/db/client";
import { findMaterialId } from "../../lib/db/materials";
import {
  completeStep,
  findOwnedSession,
  startLessonSession,
} from "../../lib/db/sessions";

/**
 * lesson_sessions の結合テスト。
 * dev_seed.sql の架空の生徒2人を使う。
 */

const hasDb = Boolean(process.env.DATABASE_URL);

const STUDENT_A = "33333333-3333-4333-8333-333333333333";
const STUDENT_B = "44444444-4444-4444-8444-444444444444";

describe.skipIf(!hasDb)("授業セッション", () => {
  afterAll(async () => {
    // 作ったセッションを片付ける
    await query(`delete from lesson_sessions where student_id in ($1, $2)`, [
      STUDENT_A,
      STUDENT_B,
    ]);
    await closePool();
  });

  async function newSession(studentId: string) {
    const materialId = await findMaterialId("school-uniforms", "beginner");
    if (!materialId) {
      throw new Error(
        "教材が見つからない。npm run db:local && npm run seed:content を先に実行すること",
      );
    }
    return startLessonSession({
      studentId,
      materialId,
      rubricVersion: "v1",
      promptVersion: "v1",
    });
  }

  it("開始時に rubric_version と prompt_version が固定される", async () => {
    const session = await newSession(STUDENT_A);

    expect(session.currentStep).toBe(1);
    expect(session.status).toBe("in_progress");
    expect(session.rubricVersion).toBe("v1");
    expect(session.promptVersion).toBe("v1");
  });

  it("未完了の同一教材セッションがあれば作り直さない", async () => {
    const first = await newSession(STUDENT_A);
    const second = await newSession(STUDENT_A);

    expect(second.id).toBe(first.id);
  });

  it("他人のセッションは引けない", async () => {
    const session = await newSession(STUDENT_A);

    // 所有者なら引ける
    await expect(
      findOwnedSession(session.id, STUDENT_A),
    ).resolves.not.toBeNull();

    // 他人だと null。呼び出し側は 404 を返す（403 にしない）
    await expect(findOwnedSession(session.id, STUDENT_B)).resolves.toBeNull();
  });

  it("step が食い違うときは current_step を進めない", async () => {
    const session = await newSession(STUDENT_B);
    expect(session.currentStep).toBe(1);

    // モデルが step 5 の完了を主張しても、アプリ側は 1 のまま
    const skipped = await completeStep(session.id, STUDENT_B, 5);
    expect(skipped.advanced).toBe(false);
    expect(skipped.currentStep).toBe(1);

    const advanced = await completeStep(session.id, STUDENT_B, 1);
    expect(advanced.advanced).toBe(true);
    expect(advanced.currentStep).toBe(2);

    // 同じ step をもう一度完了しても二重に進まない
    const again = await completeStep(session.id, STUDENT_B, 1);
    expect(again.advanced).toBe(false);
    expect(again.currentStep).toBe(2);
  });
});
