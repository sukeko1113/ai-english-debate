import { handleRouteError, jsonError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { recordArgument } from "@/lib/db/arguments";
import { findOwnedSession } from "@/lib/db/sessions";

/**
 * POST /api/results/argument — 生徒が作った論拠を記録する。**採点しない。**
 *
 * 仕様は docs/API_SPEC.md「POST /api/results/argument」。
 *
 *   - en_text が空でも受け付ける（Step 5 / S110 では日本語だけ）
 *   - 同じ日本語に対する2回目は en_text の追記として扱う
 *   - **ja_text を上書きしない。** 日本語原文は保存し続ける
 *   - 所有者を検証する。他人のセッションは 404
 */

const MAX_TEXT_LENGTH = 2000;

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

    const side = args.side;
    const jaText = args.ja_text;
    const enText = args.en_text ?? "";

    if (side !== "agree" && side !== "disagree") {
      return jsonError(400, "side は agree か disagree のみです");
    }
    if (typeof jaText !== "string" || jaText.trim().length === 0) {
      return jsonError(400, "ja_text が必要です");
    }
    if (typeof enText !== "string") {
      return jsonError(400, "en_text が正しくありません");
    }
    if (jaText.length > MAX_TEXT_LENGTH || enText.length > MAX_TEXT_LENGTH) {
      return jsonError(400, "テキストが長すぎます");
    }

    const session = await findOwnedSession(lessonSessionId, student.id);
    if (!session) return notFound();

    await recordArgument({
      sessionId: session.id,
      side,
      jaText: jaText.trim(),
      enText: enText.trim().length > 0 ? enText.trim() : null,
    });

    // 正誤も点数も返さない（docs/API_SPEC.md）
    return Response.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

function readBody(body: unknown): {
  lessonSessionId: unknown;
  args: { side?: unknown; ja_text?: unknown; en_text?: unknown };
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
