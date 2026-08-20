import { handleRouteError, jsonError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { findOwnedSession } from "@/lib/db/sessions";
import { addUsage, modelForSession, type UsageDelta } from "@/lib/db/usage";
import { estimateCostUsd } from "@/lib/openai/pricing";

/**
 * POST /api/results/usage — API 利用量を記録する。
 *
 * 仕様は docs/API_SPEC.md「POST /api/results/usage」。
 * 記録する項目は docs/REALTIME_ARCHITECTURE.md §8。
 *
 * docs/API_SPEC.md からの意図的な逸脱:
 *   仕様ではリクエストに model が入っているが、**ブラウザの申告は使わない。**
 *   model は費用計算に直結するので、接続時に realtime_calls へ記録した
 *   サーバー側の値を使う。リクエストの model は無視する。
 */

/** 1回の応答で出るトークン数の上限。桁違いの値を弾く */
const MAX_TOKENS_PER_REPORT = 1_000_000;

interface RawBody {
  lessonSessionId?: unknown;
  audioInputTokens?: unknown;
  audioOutputTokens?: unknown;
  textInputTokens?: unknown;
  textOutputTokens?: unknown;
}

function tokenCount(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_TOKENS_PER_REPORT) return null;
  return Math.floor(value);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const student = await requireStudent();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "リクエストの形式が正しくありません");
    }

    const raw: RawBody =
      typeof body === "object" && body !== null ? (body as RawBody) : {};

    if (
      typeof raw.lessonSessionId !== "string" ||
      raw.lessonSessionId.length === 0
    ) {
      return jsonError(400, "lessonSessionId が必要です");
    }

    const audioInputTokens = tokenCount(raw.audioInputTokens);
    const audioOutputTokens = tokenCount(raw.audioOutputTokens);
    const textInputTokens = tokenCount(raw.textInputTokens);
    const textOutputTokens = tokenCount(raw.textOutputTokens);

    if (
      audioInputTokens === null ||
      audioOutputTokens === null ||
      textInputTokens === null ||
      textOutputTokens === null
    ) {
      return jsonError(400, "トークン数が正しくありません");
    }

    const delta: UsageDelta = {
      audioInputTokens,
      audioOutputTokens,
      textInputTokens,
      textOutputTokens,
    };

    const session = await findOwnedSession(raw.lessonSessionId, student.id);
    if (!session) return notFound();

    // モデル名はブラウザから受け取らない。接続時に記録した値を使う
    const model = await modelForSession(session.id);
    if (!model) {
      // まだ一度も接続していないセッション。記録する利用量が無い
      return jsonError(409, "このセッションはまだ接続していません");
    }

    const usage = await addUsage({
      sessionId: session.id,
      model,
      delta,
      // 単価が未設定のモデルは null のまま。0 で埋めない
      estimatedCostUsd: estimateCostUsd(model, delta),
    });

    return Response.json({ ok: true, connectedSeconds: usage?.connectedSeconds ?? 0 });
  } catch (error) {
    return handleRouteError(error);
  }
}
