import { handleRouteError, jsonError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { findOwnedSession } from "@/lib/db/sessions";
import { appendTranscript, type TranscriptItem } from "@/lib/db/transcript";
import { SPEAKERS, type Speaker } from "@/lib/db/types";

/**
 * POST /api/results/transcript — 書き起こしを逐次保存する。
 *
 * 仕様は docs/API_SPEC.md「POST /api/results/transcript」。
 *
 * 書き起こしもブラウザ経由なので改ざんされうる
 * （docs/REALTIME_ARCHITECTURE.md §6）。MVP では完全な防止を狙わず、
 * 検証できるところを検証して保存する。
 *   - 所有者を検証する。他人のセッションは 404
 *   - speaker は student / tutor のみ
 *   - seq はサーバーが採番する（クライアントの値は並び順にだけ使う）
 *   - 長さと件数に上限を置く
 */

/** 1回に送れる件数 */
const MAX_ITEMS = 50;
/** 1発話の長さ。Realtime の1ターンとしては十分な余裕 */
const MAX_TEXT_LENGTH = 5000;
/** セッション開始からの相対ミリ秒の上限（12時間） */
const MAX_STARTED_AT_MS = 12 * 60 * 60 * 1000;

interface RawItem {
  seq?: unknown;
  speaker?: unknown;
  text?: unknown;
  startedAtMs?: unknown;
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

    const { lessonSessionId, items } = readBody(body);
    if (typeof lessonSessionId !== "string" || lessonSessionId.length === 0) {
      return jsonError(400, "lessonSessionId が必要です");
    }
    if (!Array.isArray(items)) {
      return jsonError(400, "items が必要です");
    }
    if (items.length === 0) {
      return Response.json({ ok: true, saved: 0 });
    }
    if (items.length > MAX_ITEMS) {
      return jsonError(400, "items が多すぎます");
    }

    const parsed = parseItems(items);
    if (!parsed) return jsonError(400, "items の形式が正しくありません");

    const session = await findOwnedSession(lessonSessionId, student.id);
    if (!session) return notFound();

    const saved = await appendTranscript(session.id, parsed);

    return Response.json({ ok: true, saved });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 形を検証しつつ、クライアントの seq で並べ替える */
function parseItems(items: readonly unknown[]): TranscriptItem[] | null {
  const parsed: { order: number; item: TranscriptItem }[] = [];

  for (const [index, raw] of items.entries()) {
    if (typeof raw !== "object" || raw === null) return null;
    const candidate = raw as RawItem;

    const speaker = SPEAKERS.find(
      (known): known is Speaker => known === candidate.speaker,
    );
    if (!speaker) return null;

    if (typeof candidate.text !== "string") return null;
    const text = candidate.text.trim();
    if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return null;

    const startedAtMs = candidate.startedAtMs;
    if (
      typeof startedAtMs !== "number" ||
      !Number.isFinite(startedAtMs) ||
      startedAtMs < 0 ||
      startedAtMs > MAX_STARTED_AT_MS
    ) {
      return null;
    }

    // seq は保存には使わない。バッチ内の並び順にだけ使う
    const order =
      typeof candidate.seq === "number" && Number.isFinite(candidate.seq)
        ? candidate.seq
        : index;

    parsed.push({
      order,
      item: { speaker, text, startedAtMs: Math.floor(startedAtMs) },
    });
  }

  return parsed
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.item);
}

function readBody(body: unknown): {
  lessonSessionId: unknown;
  items: unknown;
} {
  if (typeof body !== "object" || body === null) {
    return { lessonSessionId: undefined, items: undefined };
  }
  const record = body as Record<string, unknown>;
  return { lessonSessionId: record.lessonSessionId, items: record.items };
}
