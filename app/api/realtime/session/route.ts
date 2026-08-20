import { handleRouteError, jsonError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { getLessonMaterial, getLessonPhases } from "@/lib/db/materials";
import { countRecentCalls, recordRealtimeCall } from "@/lib/db/realtime";
import { findOwnedSession, setCurrentPhase } from "@/lib/db/sessions";
import {
  createRealtimeCall,
  getRealtimeModel,
  OpenAIConfigError,
  OpenAIRequestError,
} from "@/lib/openai/client";
import { buildInstructions, resolvePhase } from "@/lib/openai/instructions";
import { safetyIdFor } from "@/lib/openai/safety-id";
import { buildRealtimeSession } from "@/lib/openai/session-config";
import { LESSON_TOOLS } from "@/lib/openai/tools";

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
    const { instructions, tools } = await sessionSetupFor(session);

    const result = await createRealtimeCall({
      sdp,
      session: buildRealtimeSession({ model, instructions, tools }),
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

/**
 * 教材と現在フェーズから instructions と tool を決める。
 *
 * フェーズはアプリ側の lesson_sessions.current_phase が正。未設定なら
 * 教材の最初のフェーズを使い、その値を保存する。以後は接続が切れても
 * ここから再開できる（docs/REALTIME_ARCHITECTURE.md §5、§7）。
 *
 * 教材にフェーズ定義が無ければ undefined を返し、
 * lib/openai/session-config.ts の既定 instructions に任せる。
 */
async function sessionSetupFor(session: {
  id: string;
  studentId: string;
  materialId: string;
  currentPhase: string | null;
}): Promise<{
  instructions: string | undefined;
  tools: typeof LESSON_TOOLS | undefined;
}> {
  const [material, phases] = await Promise.all([
    getLessonMaterial(session.materialId),
    getLessonPhases(session.materialId),
  ]);
  if (!material) return { instructions: undefined, tools: undefined };

  // 記録する対象（questions）が無い教材には tool を渡さない。
  // 渡せばモデルが呼べてしまい、必ず弾かれる呼び出しが増えるだけ
  const tools = material.questions.length > 0 ? LESSON_TOOLS : undefined;

  const resolved = resolvePhase(phases, session.currentPhase);
  if (!resolved) return { instructions: undefined, tools };

  if (session.currentPhase !== resolved.phase.id) {
    await setCurrentPhase(session.id, session.studentId, resolved.phase.id);
  }

  return {
    instructions: buildInstructions({
      material,
      phase: resolved.phase,
      isLastPhase: resolved.isLastPhase,
    }),
    tools,
  };
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
