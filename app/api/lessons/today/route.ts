import { handleRouteError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import {
  findMaterialForLevel,
  getLessonMaterial,
} from "@/lib/db/materials";
import { findUnfinishedSession } from "@/lib/db/sessions";

/**
 * GET /api/lessons/today — 今日割り当てられている教材を返す。
 * 仕様は docs/API_SPEC.md「GET /api/lessons/today」。
 *
 * **questions に answer を含めない。** getLessonMaterial は answer を
 * select していないので、このルートで正解に触れる経路が無い。
 * 採点用の getQuestionsWithAnswers をここから呼ばないこと。
 */
export async function GET(): Promise<Response> {
  try {
    const student = await requireStudent();

    const materialId = await findMaterialForLevel(student.currentLevel);
    if (!materialId) return notFound();

    const material = await getLessonMaterial(materialId);
    if (!material) return notFound();

    const existing = await findUnfinishedSession(student.id, materialId);

    return Response.json({
      materialId: material.materialId,
      topic: {
        titleEn: material.topic.titleEn,
        titleJa: material.topic.titleJa,
      },
      level: material.level,
      objectives: material.objectives,
      script: material.script,
      vocabulary: material.vocabulary,
      grammarPoints: material.grammarPoints,
      questions: material.questions,
      // 進行の目安。質問文・受理する答え・ヒントは含まない
      phases: material.phases,
      existingSessionId: existing?.id ?? null,
      currentPhase: existing?.currentPhase ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
