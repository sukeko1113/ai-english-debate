/**
 * モデルごとの単価表（docs/DATA_MODEL.md `session_usage`）。
 *
 * 「1授業あたりいくらか」を出すために使う。基本設計書 §15 Step 11
 * （30〜40人実証）で必要になる数字。
 *
 * **単価をここに推測で書かない。**
 * 単価は OpenAI の価格ページを見て入れる。入っていないモデルは
 * estimateCostUsd() が null を返し、session_usage.estimated_cost_usd は
 * 空のままになる。トークン数と接続時間は記録され続けるので、
 * 後から単価を入れて再計算できる。
 *
 * TODO(要確認): 実際に使うモデルの単価を RATE_TABLE に入れる。
 * 価格改定に備えて、入れた日付をコメントで残すこと。
 */

/** 100万トークンあたりの USD */
export interface ModelRate {
  audioInputPerMillion: number;
  audioOutputPerMillion: number;
  textInputPerMillion: number;
  textOutputPerMillion: number;
  /** 価格を確認した日。改定時に見直す目印 */
  checkedOn: string;
}

/**
 * 例（値は入っていない。実際の価格を確認して追加する）:
 *
 *   "gpt-realtime-2.1": {
 *     audioInputPerMillion: 0,
 *     audioOutputPerMillion: 0,
 *     textInputPerMillion: 0,
 *     textOutputPerMillion: 0,
 *     checkedOn: "2026-08-20",
 *   },
 */
export const RATE_TABLE: Readonly<Record<string, ModelRate>> = {};

export interface TokenCounts {
  audioInputTokens: number;
  audioOutputTokens: number;
  textInputTokens: number;
  textOutputTokens: number;
}

const PER_MILLION = 1_000_000;

/**
 * 概算費用。単価が分からないモデルは null。
 * **null を 0 にしない。** 「0円だった」と「まだ分からない」は別物。
 */
export function estimateCostUsd(
  model: string,
  tokens: TokenCounts,
  rates: Readonly<Record<string, ModelRate>> = RATE_TABLE,
): number | null {
  const rate = rates[model];
  if (!rate) return null;

  const usd =
    (tokens.audioInputTokens * rate.audioInputPerMillion) / PER_MILLION +
    (tokens.audioOutputTokens * rate.audioOutputPerMillion) / PER_MILLION +
    (tokens.textInputTokens * rate.textInputPerMillion) / PER_MILLION +
    (tokens.textOutputTokens * rate.textOutputPerMillion) / PER_MILLION;

  // session_usage.estimated_cost_usd は numeric(10,4)
  return Math.round(usd * 10_000) / 10_000;
}
