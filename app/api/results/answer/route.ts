import { handleRouteError, jsonError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { recordAnswer } from "@/lib/db/answers";
import { questionBelongsToMaterial } from "@/lib/db/materials";
import { findOwnedSession } from "@/lib/db/sessions";

/**
 * POST /api/results/answer — 答案を記録する。**採点しない。**
 *
 * 仕様は docs/API_SPEC.md「POST /api/results/answer」。
 *
 * この API は「モデルから来た」という前提を一切置かない
 * （docs/REALTIME_ARCHITECTURE.md §1）。値はブラウザのデータチャネルを
 * 通っており、すべて改ざん可能。通常の Web フォーム送信と同じ厳しさで検証する。
 *
 *   - student_id はボディから受け取らない。認証セッションから引く
 *   - lessonSessionId は所有者を検証する。他人のものは 404
 *   - item_id は、そのセッションの教材に属する questions.id であることを検証
 *   - **正誤も点数も返さない。** 返すとモデルがそれを口に出す
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 生徒1回分の答案の上限。ブラウザ由来の値なので長さを縛る */
const MAX_ANSWER_LENGTH = 2000;
const MAX_ATTEMPT_NO = 20;

export async function POST(request: Request): Promise<Response> {
  try {
    const student = await requireStudent();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "リクエストの形式が正しくありません");
    }

    const { lessonSessionId, args } = readBody(body);
    if (typeof lessonSessionId !== "string" || lessonSessionId.length === 0) {
      return jsonError(400, "lessonSessionId が必要です");
    }

    const itemId = args.item_id;
    const answerText = args.answer_text;
    const attemptNo = args.attempt_no ?? 1;

    if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId)) {
      return jsonError(400, "item_id が正しくありません");
    }
    if (typeof answerText !== "string") {
      return jsonError(400, "answer_text が必要です");
    }
    if (answerText.length > MAX_ANSWER_LENGTH) {
      return jsonError(400, "answer_text が長すぎます");
    }
    if (
      typeof attemptNo !== "number" ||
      !Number.isInteger(attemptNo) ||
      attemptNo < 1 ||
      attemptNo > MAX_ATTEMPT_NO
    ) {
      return jsonError(400, "attempt_no が正しくありません");
    }

    // 所有者検証。他人のセッションなら存在を漏らさず 404
    const session = await findOwnedSession(lessonSessionId, student.id);
    if (!session) return notFound();

    // 渡された item_id をそのまま保存しない。教材に属するかを必ず確かめる
    const belongs = await questionBelongsToMaterial(itemId, session.materialId);
    if (!belongs) {
      return jsonError(400, "item_id がこの授業の教材に含まれていません");
    }

    await recordAnswer({
      sessionId: session.id,
      questionId: itemId,
      attemptNo,
      answerText,
    });

    // 正誤・点数を返さない（docs/API_SPEC.md）
    return Response.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

function readBody(body: unknown): {
  lessonSessionId: unknown;
  args: {
    item_id?: unknown;
    answer_text?: unknown;
    attempt_no?: unknown;
  };
} {
  if (typeof body !== "object" || body === null) {
    return { lessonSessionId: undefined, args: {} };
  }
  const record = body as Record<string, unknown>;
  const rawArgs = record.args;
  const args =
    typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  return { lessonSessionId: record.lessonSessionId, args };
}
