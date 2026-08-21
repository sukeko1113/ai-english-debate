import { afterAll, describe, expect, it } from "vitest";

import { closePool } from "@/lib/db/client";
import {
  findMaterialForLevel,
  getLessonMaterial,
  getLessonPhases,
  getQuestionsWithAnswers,
} from "@/lib/db/materials";

/**
 * Club Activities の授業フェーズ（AI教師プロンプト v03 §6）。
 *
 * S90_DICTATION と S100_WRITING は「画面へ書く」段階で、
 * フェーズは item_keys で questions を参照する。
 */

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("Club Activities のフェーズ", () => {
  afterAll(async () => {
    await closePool();
  });

  async function materialId(): Promise<string> {
    const id = await findMaterialForLevel("intermediate");
    if (!id) throw new Error("教材が無い。npm run seed:content が必要");
    return id;
  }

  it("v03 の15段階がそろっている", async () => {
    const phases = await getLessonPhases(await materialId());

    expect(phases.map((phase) => phase.id)).toEqual([
      "S00_START",
      "S10_OPENING",
      "S20_SIGNPOST",
      "S30_PRESENT_SITUATION_1",
      "S40_PRESENT_SITUATION_2",
      "S50_CAUSE",
      "S60_SERIOUSNESS",
      "S70_CONCLUSION",
      "S80_LOGIC_CHECK",
      "S90_DICTATION",
      "S100_WRITING",
      "S110_ARGUMENT_BUILDING",
      "S120_SPEAKING",
      "S130_MINI_DEBATE",
      "S140_REVIEW_AND_SAVE",
    ]);
  });

  it("書く課題のフェーズが questions を参照している", async () => {
    const phases = await getLessonPhases(await materialId());
    const byId = new Map(phases.map((phase) => [phase.id, phase]));

    expect(byId.get("S90_DICTATION")?.itemKeys).toEqual([
      "dict-1",
      "dict-2",
      "dict-3",
    ]);
    expect(byId.get("S100_WRITING")?.itemKeys).toEqual([
      "write-1",
      "write-2",
      "write-3",
      "write-4",
    ]);

    // 音声で進めるフェーズは書く課題を持たない
    expect(byId.get("S00_START")?.itemKeys).toEqual([]);
  });

  it("参照している key が実在する問題である", async () => {
    const id = await materialId();
    const phases = await getLessonPhases(id);
    const questions = await getQuestionsWithAnswers(id);
    const known = new Set(questions.map((question) => question.key));

    for (const phase of phases) {
      for (const key of phase.itemKeys) {
        expect(known, `${phase.id} が参照する ${key}`).toContain(key);
      }
    }
  });

  it("ディクテーションと英作文の正解は生徒へ渡さない", async () => {
    const id = await materialId();
    const material = await getLessonMaterial(id);
    const raw = JSON.stringify(material);

    // 本文に無い模範解答が漏れていないこと。
    // ディクテーションの正解文は本文そのものなので、この検査には使えない
    expect(raw).not.toContain("Schools require students to wear uniforms.");
    expect(raw).not.toContain("唯一の正解ではない");

    for (const question of material?.questions ?? []) {
      expect(Object.keys(question)).not.toContain("answer");
    }
  });

  it("採点側では正解が読める", async () => {
    const questions = await getQuestionsWithAnswers(await materialId());
    const dictation = questions.find((question) => question.key === "dict-1");

    expect(dictation?.answer).toBe(
      "I am speaking against making club activities optional.",
    );
  });
});
