import { queryOne } from "./client";

/**
 * API 利用量の記録（docs/DATA_MODEL.md `session_usage`）。
 *
 * 「1授業あたりいくらか」を出すための表。基本設計書 §15 Step 11 で使う。
 *
 * 数値はブラウザ経由で届くので改ざんされうる
 * （docs/REALTIME_ARCHITECTURE.md §1）。ただし成績には影響しない
 * コスト計測用の値で、完全な防止には WebSocket をサーバー中継する構成が要る。
 * MVP ではその複雑さを取らず、次の2つだけサーバー側で決める。
 *   - model: realtime_calls に記録した値を使う。ブラウザの申告を信じない
 *   - connected_seconds: 最初の接続からの経過秒。サーバーの時計で出す
 */

export interface UsageDelta {
  audioInputTokens: number;
  audioOutputTokens: number;
  textInputTokens: number;
  textOutputTokens: number;
}

export interface SessionUsage extends UsageDelta {
  model: string;
  connectedSeconds: number;
  estimatedCostUsd: number | null;
}

interface UsageRow {
  model: string;
  audio_input_tokens: string;
  audio_output_tokens: string;
  text_input_tokens: string;
  text_output_tokens: string;
  connected_seconds: number;
  estimated_cost_usd: string | null;
}

function toUsage(row: UsageRow): SessionUsage {
  return {
    model: row.model,
    audioInputTokens: Number(row.audio_input_tokens),
    audioOutputTokens: Number(row.audio_output_tokens),
    textInputTokens: Number(row.text_input_tokens),
    textOutputTokens: Number(row.text_output_tokens),
    connectedSeconds: row.connected_seconds,
    estimatedCostUsd:
      row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
  };
}

/**
 * このセッションで実際に使ったモデル名。
 * /api/realtime/session が接続時に realtime_calls へ記録した値。
 */
export async function modelForSession(
  sessionId: string,
): Promise<string | null> {
  const row = await queryOne<{ model: string }>(
    `select model from realtime_calls
      where session_id = $1 order by created_at desc limit 1`,
    [sessionId],
  );
  return row?.model ?? null;
}

/**
 * 利用量を足し込む。1応答ごとに差分が届くので、既存の値に加算する。
 *
 * connected_seconds は最初の接続からの経過秒をサーバー側で出す。
 * **接続の切れ目を含む上限値**であって、正味の通話時間ではない。
 * 授業単価の桁を掴むには足りるが、厳密な通話時間が要るようになったら
 * 接続ごとの終了時刻を持つ必要がある。
 */
export async function addUsage(params: {
  sessionId: string;
  model: string;
  delta: UsageDelta;
  estimatedCostUsd: number | null;
}): Promise<SessionUsage | null> {
  const row = await queryOne<UsageRow>(
    `insert into session_usage as u
       (session_id, model,
        audio_input_tokens, audio_output_tokens,
        text_input_tokens, text_output_tokens,
        connected_seconds, estimated_cost_usd, updated_at)
     values (
       $1, $2, $3, $4, $5, $6,
       coalesce((
         select floor(extract(epoch from (now() - min(created_at))))::int
           from realtime_calls where session_id = $1
       ), 0),
       $7, now())
     on conflict (session_id) do update
       set model               = excluded.model,
           audio_input_tokens  = u.audio_input_tokens  + excluded.audio_input_tokens,
           audio_output_tokens = u.audio_output_tokens + excluded.audio_output_tokens,
           text_input_tokens   = u.text_input_tokens   + excluded.text_input_tokens,
           text_output_tokens  = u.text_output_tokens  + excluded.text_output_tokens,
           connected_seconds   = greatest(u.connected_seconds, excluded.connected_seconds),
           estimated_cost_usd  = case
                                   when excluded.estimated_cost_usd is null then u.estimated_cost_usd
                                   else coalesce(u.estimated_cost_usd, 0) + excluded.estimated_cost_usd
                                 end,
           updated_at          = now()
     returning model, audio_input_tokens, audio_output_tokens,
               text_input_tokens, text_output_tokens,
               connected_seconds, estimated_cost_usd`,
    [
      params.sessionId,
      params.model,
      params.delta.audioInputTokens,
      params.delta.audioOutputTokens,
      params.delta.textInputTokens,
      params.delta.textOutputTokens,
      params.estimatedCostUsd,
    ],
  );
  return row ? toUsage(row) : null;
}

/** 教師画面とコスト集計で使う */
export async function getSessionUsage(
  sessionId: string,
): Promise<SessionUsage | null> {
  const row = await queryOne<UsageRow>(
    `select model, audio_input_tokens, audio_output_tokens,
            text_input_tokens, text_output_tokens,
            connected_seconds, estimated_cost_usd
       from session_usage where session_id = $1`,
    [sessionId],
  );
  return row ? toUsage(row) : null;
}
