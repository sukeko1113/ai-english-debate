import { afterAll, describe, expect, it } from "vitest";

import { closePool } from "../../lib/db/client";
import {
  findMaterialId,
  getLessonMaterial,
  getQuestionsWithAnswers,
  questionBelongsToMaterial,
} from "../../lib/db/materials";

/**
 * lib/db の結合テスト。実際の PostgreSQL に対して走らせる。
 *
 *   npm run db:local && npm run seed:content
 *   DATABASE_URL=postgres://aied:aied@localhost:5432/aied npm run test
 *
 * DATABASE_URL が無い環境（CI の初期状態など）では丸ごとスキップする。
 */

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("教材の取得", () => {
  afterAll(async () => {
    await closePool();
  });

  async function beginnerMaterialId(): Promise<string> {
    const id = await findMaterialId("school-uniforms", "beginner");
    if (!id) {
      throw new Error(
        "教材が見つからない。npm run db:local && npm run seed:content を先に実行すること",
      );
    }
    return id;
  }

  it("教材 JSON の内容が DB から戻る", async () => {
    const material = await getLessonMaterial(await beginnerMaterialId());

    expect(material).not.toBeNull();
    expect(material?.topic.code).toBe("school-uniforms");
    expect(material?.level).toBe("beginner");
    expect(material?.objectives.length).toBeGreaterThan(0);
    expect(material?.vocabulary.length).toBe(5);
    expect(material?.grammarPoints.length).toBe(3);
    expect(material?.questions.length).toBe(7);
    expect(material?.debateTasks.length).toBe(2);
    // Step 8 で AI が使う反論（docs/LESSON_FLOW.md Step 8）
    expect(material?.counterarguments.length).toBe(4);
  });

  it("生徒へ渡す教材に正解が含まれない", async () => {
    const material = await getLessonMaterial(await beginnerMaterialId());
    const serialized = JSON.stringify(material);

    // docs/API_SPEC.md: questions に answer を含めない
    for (const question of material?.questions ?? []) {
      expect(Object.keys(question)).not.toContain("answer");
    }

    // 教材 JSON の正解文がそのまま混ざっていないこと
    expect(serialized).not.toContain(
      "Some students like uniforms because they are easy to wear.",
    );
    // 模範解答・教員向けメモも渡さない
    expect(serialized).not.toContain("model_answers");
    expect(serialized).not.toContain("teacher_note");
  });

  it("採点用の取得では正解が読める", async () => {
    const questions = await getQuestionsWithAnswers(await beginnerMaterialId());
    const dictation = questions.find((q) => q.key === "dict-1");

    expect(dictation?.answer).toBe(
      "Some students like uniforms because they are easy to wear.",
    );
  });

  it("別教材の question_id を弾く", async () => {
    const materialId = await beginnerMaterialId();
    const questions = await getQuestionsWithAnswers(materialId);
    const known = questions[0];
    expect(known).toBeDefined();

    await expect(
      questionBelongsToMaterial(known!.id, materialId),
    ).resolves.toBe(true);

    // 存在しない教材に属するかを聞けば false
    await expect(
      questionBelongsToMaterial(
        known!.id,
        "00000000-0000-4000-8000-000000000000",
      ),
    ).resolves.toBe(false);
  });
});
