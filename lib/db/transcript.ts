import { query, transaction } from "./client";
import type { Speaker } from "./types";

/**
 * 会話の書き起こし（docs/DATA_MODEL.md `session_transcript`）。
 *
 * **音声そのものは保存しない。書き起こしだけ**（docs/SECURITY.md §4）。
 * 採点はセッション終了後にここから行うので、必ず保存する
 * （docs/REALTIME_ARCHITECTURE.md §6）。
 *
 * TODO(要確認): 未成年の発話記録なので保持期間を決める必要がある
 * （docs/SECURITY.md §4 の初期案は「学年度末 + 1年」）。
 * 削除の手順とあわせて、学校運用前に決める。
 */

export interface TranscriptItem {
  speaker: Speaker;
  text: string;
  /** セッション開始からの相対ミリ秒。間の取り方を見るのに使う */
  startedAtMs: number;
}

export interface TranscriptLine extends TranscriptItem {
  seq: number;
}

/**
 * 書き起こしを追記する。**seq はサーバーが採番する。**
 *
 * ブラウザの seq をそのまま使うと、再接続で採番が振り出しに戻ったときに
 * 既存の行とぶつかり、unique 制約で新しい行が捨てられる。
 * クライアントの seq は「このバッチの中の並び順」にだけ使う
 * （docs/REALTIME_ARCHITECTURE.md §1: ブラウザ由来の値は信用しない）。
 */
export async function appendTranscript(
  sessionId: string,
  items: readonly TranscriptItem[],
): Promise<number> {
  if (items.length === 0) return 0;

  return transaction(async (tx) => {
    const rows = await tx.query<{ max_seq: number | null }>(
      `select max(seq) as max_seq from session_transcript where session_id = $1`,
      [sessionId],
    );
    let seq = (rows[0]?.max_seq ?? 0) + 1;

    for (const item of items) {
      await tx.query(
        `insert into session_transcript
           (session_id, seq, speaker, text, started_at_ms)
         values ($1, $2, $3, $4, $5)`,
        [sessionId, seq, item.speaker, item.text, item.startedAtMs],
      );
      seq += 1;
    }
    return items.length;
  });
}

/** 書き起こしを順に読む。採点と教師画面で使う */
export async function getTranscript(
  sessionId: string,
): Promise<TranscriptLine[]> {
  const rows = await query<{
    seq: number;
    speaker: Speaker;
    text: string;
    started_at_ms: number;
  }>(
    `select seq, speaker, text, started_at_ms
       from session_transcript where session_id = $1 order by seq`,
    [sessionId],
  );
  return rows.map((row) => ({
    seq: row.seq,
    speaker: row.speaker,
    text: row.text,
    startedAtMs: row.started_at_ms,
  }));
}
