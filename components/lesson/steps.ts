/**
 * 画面表示用の9ステップ名（docs/LESSON_FLOW.md）。
 *
 * **これは表示専用。** モデルへ渡すステップ定義（指示文・完了条件・使える tool）は
 * Task 5 で lib/openai/steps.ts に作る。定義を二重に持たないよう、
 * 指示文や完了条件をここへ書かないこと。
 */
export interface StepLabel {
  no: number;
  nameJa: string;
}

export const STEP_LABELS: readonly StepLabel[] = [
  { no: 1, nameJa: "レベル判定" },
  { no: 2, nameJa: "教材提示" },
  { no: 3, nameJa: "基礎学習" },
  { no: 4, nameJa: "理解度確認" },
  { no: 5, nameJa: "論拠作成（日本語）" },
  { no: 6, nameJa: "英語化" },
  { no: 7, nameJa: "スピーキング" },
  { no: 8, nameJa: "AIディベート" },
  { no: 9, nameJa: "評価・振り返り" },
];
