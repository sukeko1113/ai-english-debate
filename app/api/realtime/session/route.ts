import { handleRouteError, jsonError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { countRecentCalls, recordRealtimeCall } from "@/lib/db/realtime";
import { findOwnedSession } from "@/lib/db/sessions";
import {
  createRealtimeCall,
  getRealtimeModel,
  OpenAIConfigError,
  OpenAIRequestError,
} from "@/lib/openai/client";
import { safetyIdFor } from "@/lib/openai/safety-id";
import { buildRealtimeSession } from "@/lib/openai/session-config";

/**
 * POST /api/realtime/session — WebRTC の SDP を中継する。
 *
 * docs/API_SPEC.md「POST /api/realtime/session」と
 * docs/REALTIME_ARCHITECTURE.md §2 のシーケンス。
 *
 * ここが OPENAI_API_KEY を使う唯一の経路。キー自体に触るのは
 * lib/openai/client.ts だけで、このファイルは触らない。
 *
 * 信頼境界（docs/REALTIME_ARCHITECTURE.md §1）:
 *   - student_id はボディから受け取らない。認証セッションから引く
 *   - lessonSessionId は所有者を検証する。他人のものは 404（403 にしない）
 *   - OpenAI のエラー本文をクライアントへ返さない
 */

/** 1生徒あたり1時間の接続上限。既定は .env.example の 6 に合わせる */
function sessionsPerHour(): number {
  const raw = Number(process.env.REALTIME_SESSIONS_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? raw : 6;
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

    const { lessonSessionId, sdp } = readBody(body);
    if (typeof lessonSessionId !== "string" || lessonSessionId.length === 0) {
      return jsonError(400, "lessonSessionId が必要です");
    }
    if (typeof sdp !== "string" || sdp.length === 0) {
      return jsonError(400, "sdp が必要です");
    }

    // 所有者検証。他人のセッションなら存在を漏らさず 404
    const session = await findOwnedSession(lessonSessionId, student.id);
    if (!session) return notFound();

    // 課金に直結するので認証済みでも上限をかける（docs/SECURITY.md §6）
    const limit = sessionsPerHour();
    const recent = await countRecentCalls(student.id, 60);
    if (recent >= limit) {
      return jsonError(429, "接続の回数が多すぎます。時間をおいて試してください");
    }

    const model = getRealtimeModel();
    const result = await createRealtimeCall({
      sdp,
      // Task 5 で教材と現在 step から instructions を組み立てて渡す
      session: buildRealtimeSession({ model }),
      safetyId: safetyIdFor(student.id),
    });

    await recordRealtimeCall({
      sessionId: session.id,
      studentId: student.id,
      callId: result.callId,
      model,
    });

    return new Response(result.sdpAnswer, {
      headers: { "Content-Type": "application/sdp" },
    });
  } catch (error) {
    if (error instanceof OpenAIRequestError) {
      // 本文はサーバーログにだけ残す。クライアントへ渡さない
      console.error("[realtime] OpenAI エラー", error.status, error.detail);
      return jsonError(502, "音声サーバーへ接続できませんでした");
    }
    if (error instanceof OpenAIConfigError) {
      console.error("[realtime] 設定不足", error.message);
      return jsonError(500, "サーバーの設定が不足しています");
    }
    return handleRouteError(error);
  }
}

function readBody(body: unknown): {
  lessonSessionId: unknown;
  sdp: unknown;
} {
  if (typeof body !== "object" || body === null) {
    return { lessonSessionId: undefined, sdp: undefined };
  }
  const record = body as Record<string, unknown>;
  return { lessonSessionId: record.lessonSessionId, sdp: record.sdp };
}
