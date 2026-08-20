import { handleRouteError, jsonError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { getMaterialVersions } from "@/lib/db/materials";
import { startLessonSession } from "@/lib/db/sessions";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/lesson-sessions — 授業を開始する。
 * 仕様は docs/API_SPEC.md「POST /api/lesson-sessions」。
 *
 * - student_id はボディから受け取らない。認証セッションから引く
 * - rubric_version / prompt_version をここで固定する
 *   （途中で基準が変わっても、その授業は開始時の基準で採点される）
 * - 未完了の同一教材セッションがあれば新規作成せずそれを返す
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const student = await requireStudent();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "リクエストの形式が正しくありません");
    }

    const materialId =
      typeof body === "object" && body !== null && "materialId" in body
        ? (body as { materialId: unknown }).materialId
        : undefined;

    if (typeof materialId !== "string" || materialId.length === 0) {
      return jsonError(400, "materialId が必要です");
    }

    // UUID でない文字列は DB へ投げる前に弾く。
    // catch で 404 にしてしまうと、DB 障害まで「教材が無い」に見えるため
    if (!UUID_PATTERN.test(materialId)) return notFound();

    const versions = await getMaterialVersions(materialId);
    if (!versions) return notFound();

    const session = await startLessonSession({
      studentId: student.id,
      materialId: versions.materialId,
      rubricVersion: versions.rubricVersion,
      promptVersion: versions.promptVersion,
    });

    return Response.json({
      lessonSessionId: session.id,
      currentStep: session.currentStep,
      rubricVersion: session.rubricVersion,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
