import { handleRouteError, jsonError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { getLessonPhases } from "@/lib/db/materials";
import { findOwnedSession, setCurrentPhase } from "@/lib/db/sessions";
import { resolvePhase } from "@/lib/openai/instructions";

/**
 * POST /api/results/phase — フェーズ通過を記録し、次のフェーズへ進める。
 *
 * docs/API_SPEC.md「POST /api/results/step」の、v03 フェーズ版
 * （docs/AI教師プロンプト_v03_ClubActivities授業実装用.md §6）。
 *
 * **進行を決めるのはアプリで、モデルではない**
 * （docs/LESSON_FLOW.md「ステップ遷移の実装」/ docs/REALTIME_ARCHITECTURE.md §5）。
 * モデルが違うフェーズの完了を主張しても current_phase は動かさない。
 *
 * **レスポンスに instructions を含めない。** v03 のフェーズ instructions には
 * 受理する答えとヒントが入っており、ブラウザへ返すと生徒が正解を読める
 * （docs/SECURITY.md §2）。モデルへの指示はサーバーから OpenAI へ直接渡す。
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

    const { lessonSessionId, phaseId } = readBody(body);
    if (typeof lessonSessionId !== "string" || lessonSessionId.length === 0) {
      return jsonError(400, "lessonSessionId が必要です");
    }
    if (typeof phaseId !== "string" || phaseId.length === 0) {
      return jsonError(400, "phase_id が必要です");
    }

    const session = await findOwnedSession(lessonSessionId, student.id);
    if (!session) return notFound();

    const phases = await getLessonPhases(session.materialId);
    const resolved = resolvePhase(phases, session.currentPhase);
    if (!resolved) {
      return jsonError(400, "この教材にはフェーズがありません");
    }

    // モデルの主張とアプリの状態が食い違ったら進めない。警告だけ残す
    if (phaseId !== resolved.phase.id) {
      console.warn(
        "[phase] モデルの主張と現在フェーズが食い違う",
        JSON.stringify({
          sessionId: session.id,
          claimed: phaseId,
          current: resolved.phase.id,
        }),
      );
      return Response.json({ ok: false, currentPhase: resolved.phase.id });
    }

    if (resolved.isLastPhase) {
      // 用意されている最後のフェーズ。ここから先へは進めない
      return Response.json({ ok: true, next_phase: null });
    }

    const currentIndex = phases.findIndex(
      (phase) => phase.id === resolved.phase.id,
    );
    const next = phases[currentIndex + 1];
    if (!next) return Response.json({ ok: true, next_phase: null });

    await setCurrentPhase(session.id, student.id, next.id);

    // 次のフェーズの「名前」だけを返す。質問文も受理する答えも返さない
    return Response.json({ ok: true, next_phase: next.id });
  } catch (error) {
    return handleRouteError(error);
  }
}

function readBody(body: unknown): {
  lessonSessionId: unknown;
  phaseId: unknown;
} {
  if (typeof body !== "object" || body === null) {
    return { lessonSessionId: undefined, phaseId: undefined };
  }
  const record = body as Record<string, unknown>;
  const rawArgs = record.args;
  const args =
    typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  return { lessonSessionId: record.lessonSessionId, phaseId: args.phase_id };
}
