import type { RealtimeServerEventBase } from "./types";

/**
 * Realtime の usage イベントから、記録する数値を取り出す。
 *
 * 1応答ごとに `response.done` が来て、その中の usage に
 * 音声・テキストのトークン数が入る（型は openai@7.5.0 の
 * RealtimeResponseUsage で確認）。
 *
 * DOM に触らない純粋な処理。ブラウザ無しでテストするため。
 */

export interface UsageDelta {
  audioInputTokens: number;
  audioOutputTokens: number;
  textInputTokens: number;
  textOutputTokens: number;
}

export const ZERO_USAGE: UsageDelta = {
  audioInputTokens: 0,
  audioOutputTokens: 0,
  textInputTokens: 0,
  textOutputTokens: 0,
};

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/**
 * usage を持つイベントなら差分を返す。持たなければ null。
 * **壊れた入力で落ちないこと。**
 */
export function toUsageDelta(
  event: RealtimeServerEventBase,
): UsageDelta | null {
  if (event.type !== "response.done") return null;

  const response = (event as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;

  const usage = (response as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;

  const input = (usage as { input_token_details?: unknown })
    .input_token_details;
  const output = (usage as { output_token_details?: unknown })
    .output_token_details;

  const inputDetails = (typeof input === "object" && input !== null
    ? input
    : {}) as Record<string, unknown>;
  const outputDetails = (typeof output === "object" && output !== null
    ? output
    : {}) as Record<string, unknown>;

  const delta: UsageDelta = {
    audioInputTokens: countOf(inputDetails.audio_tokens),
    audioOutputTokens: countOf(outputDetails.audio_tokens),
    textInputTokens: countOf(inputDetails.text_tokens),
    textOutputTokens: countOf(outputDetails.text_tokens),
  };

  const total =
    delta.audioInputTokens +
    delta.audioOutputTokens +
    delta.textInputTokens +
    delta.textOutputTokens;

  return total > 0 ? delta : null;
}
