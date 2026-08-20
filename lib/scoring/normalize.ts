/**
 * 答案の正規化（docs/RUBRIC.md「確定採点」）。
 *
 * **純粋関数。AI を使わない。** 同じ答案は必ず同じ結果になること。
 *
 * ルール:
 *   - 前後の空白を除去、連続空白を1つに
 *   - 大文字小文字を無視
 *   - 文末の `.` `!` `?` を無視
 *   - スマートクォートを ASCII に統一
 *   - **カンマは無視しない**（because の前のカンマ有無は文法事項なので）
 */

/** スマートクォート → ASCII */
const QUOTE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‛′]/g, "'"],
  [/[“”‟″]/g, '"'],
];

/** 文末に並んだ `.` `!` `?` をまとめて落とす。文中のものは残す */
const TRAILING_SENTENCE_MARKS = /[.!?]+$/;

export function normalizeAnswer(text: string): string {
  let normalized = text;

  for (const [pattern, replacement] of QUOTE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // 全角スペースも \s に含まれるので、ここでまとめて潰れる
  normalized = normalized.trim().replace(/\s+/g, " ");
  normalized = normalized.toLowerCase();

  // 落とした結果また末尾に記号が出ることはないが、空白付き "easy ." にも効くよう
  // 先に末尾の空白を落としてから判定する
  normalized = normalized.replace(/\s+([.!?]+)$/, "$1");
  normalized = normalized.replace(TRAILING_SENTENCE_MARKS, "");

  return normalized.trim();
}
