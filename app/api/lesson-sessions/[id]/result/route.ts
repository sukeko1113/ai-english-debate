import { handleRouteError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { getLessonMaterial } from "@/lib/db/materials";
import {
  getCurrentFeedback,
  getCurrentScores,
  getRubric,
} from "@/lib/db/scoring";
import { findOwnedSession } from "@/lib/db/sessions";

/**
 * GET /api/lesson-sessions/:id/result — 採点結果を返す。
 *
 * 仕様は docs/API_SPEC.md「GET /api/lesson-sessions/:id/result」。
 * status が 'scoring' の場合は点数を含めず「採点中」を返す。
 *
 * 満点は rubrics から出す。**Speaking のように scorer_kind が
 * 'record_only' の軸は合計から外す**（教員と確認済み。MVP は 85点満点）。
 * 定数で持たないのは、基準を変えたときにコード変更が要らないようにするため。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const student = await requireStudent();
    const { id } = await context.params;

    const session = await findOwnedSession(id, student.id);
    if (!session) return notFound();

    if (session.status !== "finished") {
      return Response.json({
        status: session.status === "scoring" ? "scoring" : session.status,
      });
    }

    const material = await getLessonMaterial(session.materialId);
    if (!material) return notFound();

    const rubric = await getRubric(session.rubricVersion, material.level);
    const scored = rubric.filter((axis) => axis.scorerKind !== "record_only");
    const maxScore = scored.reduce((sum, axis) => sum + axis.maxScore, 0);

    const scores = await getCurrentScores(session.id);

    // 1つの軸を確定採点とモデル採点が分担することがある
    // （docs/RUBRIC.md: Language Accuracy は確定10 + モデル10）。
    // 上書きせず足し合わせる
    const axes = scored.map((axis) => {
      const rows = scores.filter((score) => score.axis === axis.axis);
      const override = rows.find((row) => row.overriddenScore !== null);

      const awarded = rows.reduce((sum, row) => sum + row.rawScore, 0);
      // 実際に採点できた配点。まだ誰も採点していない分は含めない
      const assessedMax = rows.reduce((sum, row) => sum + row.maxScore, 0);

      return {
        axis: axis.axis,
        score: rows.length === 0 ? null : (override?.overriddenScore ?? awarded),
        /** ルーブリック上の配点 */
        max: axis.maxScore,
        /** そのうち今回採点できた配点。max より小さいことがある */
        assessedMax,
        scored: rows.length > 0,
      };
    });

    const totalScore = axes.reduce((sum, axis) => sum + (axis.score ?? 0), 0);
    const assessedMaxScore = axes.reduce(
      (sum, axis) => sum + axis.assessedMax,
      0,
    );

    return Response.json({
      status: "finished",
      totalScore,
      /** ルーブリックの満点（record_only を除く） */
      maxScore,
      /**
       * 今回実際に採点できた配点の合計。
       * モデル採点が失敗した軸や、採点器を持たない配点はここに入らない。
       * **生徒に見せる割合はこちらを分母にする。** maxScore を分母にすると、
       * 誰も採点していない配点まで「取れなかった点」に見えてしまう。
       */
      assessedMaxScore,
      axes,
      // 採点していない軸（MVP の Speaking）を明示する
      notScored: rubric
        .filter((axis) => axis.scorerKind === "record_only")
        .map((axis) => axis.axis),
      feedback: await getCurrentFeedback(session.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
