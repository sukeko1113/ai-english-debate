import type { LessonMaterial, LessonPhase } from "../db/types";

/**
 * Realtime session の instructions を組み立てる。**純粋関数。**
 *
 * 元になる授業仕様は
 * docs/AI教師プロンプト_v03_ClubActivities授業実装用.md
 * （§4 最重要の対話ルール / §11 AI教師への固定指示）。
 *
 * 守っていること:
 *   - **教材の中身をここへ書かない。** 引数で受け取る
 *     （CLAUDE.md「教材をコードに埋め込まない」）
 *   - **現在のフェーズの指示だけを入れる。** 全フェーズを1つの長い prompt に
 *     詰め込まない（docs/REALTIME_ARCHITECTURE.md §3）
 *   - **点数を言わせない。** 採点はセッション終了後にサーバー側で行う
 *     （CLAUDE.md 禁止事項2）。v03 §9 の save_lesson_result のように
 *     モデルへ点数を作らせる設計は採用しない
 */

export interface BuildInstructionsParams {
  material: LessonMaterial;
  /** アプリ側が持っている現在フェーズ（lesson_sessions.current_phase） */
  phase: LessonPhase;
  /** このフェーズが最後なら、勝手に先へ進ませない */
  isLastPhase: boolean;
}

/** v03 §4 / §11。教材によらず共通のルール */
const TEACHING_RULES = [
  "1ターンに質問は1つだけ。質問したら必ず止まり、生徒の音声回答を待つ。",
  "質問した同じターンで正解を言わない。生徒が答える前に答えを述べない。",
  "短い答えでも意味が合っていれば受け入れる。言い直しを求めない。",
  "誤答のときは、ヒント1 → ヒント2 → 正解 の順に段階的に助ける。いきなり正解を言わない。",
  "正解のあとの説明は1〜3文まで。生徒が理解した内容を繰り返し説明しない。",
  "教材にない統計・事例・新しい論拠を追加しない。教材の主張は「この立論の主張」として扱う。",
  "教材本文を書き換えない。読むときは教材のとおりに読む。",
  "点数・評価・レベル判定を口にしない。採点はアプリが行う。",
  "生徒の発話の途中で割り込まない。生徒が黙っていても数秒は待つ。",
  "説明と質問は日本語で行う。教材の英文だけは英語でゆっくり読む。",
  "生徒は日本語で答えてよい。英語を強要しない。",
  "生徒が「本文を出して」「もう一回」「ゆっくり」「日本語で」と言ったら、それに従う。",
];

function renderQuestion(
  question: LessonPhase["questions"][number],
  index: number,
): string {
  const lines = [
    `### 質問${index + 1}（key: ${question.key}）`,
    `聞くこと: ${question.askJa}`,
    `受け入れる答え: ${question.accept.join(" / ")}`,
  ];
  question.hints.forEach((hint, hintIndex) => {
    lines.push(`ヒント${hintIndex + 1}（誤答のとき順に出す）: ${hint}`);
  });
  if (question.confirmJa) {
    lines.push(`正解後の確認（1〜3文で言う）: ${question.confirmJa}`);
  }
  return lines.join("\n");
}

export function buildInstructions(params: BuildInstructionsParams): string {
  const { material, phase, isLastPhase } = params;

  const sections: string[] = [
    "あなたは日本人高校生・大学初年次向けの英語ディベート教師です。",
    "一方的に講義せず、「1問質問 → 生徒が答える → 短く確認 → 次の1問」のテンポで進めます。",
    "",
    "## 授業ルール",
    TEACHING_RULES.map((rule, index) => `${index + 1}. ${rule}`).join("\n"),
    "",
    "## 今日の教材",
    `テーマ: ${material.topic.titleJa}（${material.topic.titleEn}）`,
    `レベル: ${material.level}`,
    `到達目標: ${material.objectives.join(" / ")}`,
    "",
    "本文（この範囲の外へ出ない）:",
    material.script,
    "",
    "## いま扱うところ",
    `セクション: ${phase.section}（${phase.labelJa}）`,
    `注目する文: ${phase.focusSentence}`,
  ];

  if (phase.openingJa) {
    sections.push("", `最初に言うこと: ${phase.openingJa}`);
  }

  sections.push(
    "",
    "## このターンで扱う質問",
    "**下の質問を上から順に1つずつ出します。1つ質問したら必ず止まって回答を待ちます。**",
    "",
    phase.questions.map(renderQuestion).join("\n\n"),
    "",
    "## このフェーズが終わったら",
    isLastPhase
      ? [
          "ここまでが今日の範囲です。次のセクションへ進まないでください。",
          "「今日はここまでです。次回は続きの Signpost から進めます」と伝えて終わります。",
          "生徒が続きを求めても、まだ用意ができていないことを伝えて終わります。",
        ].join("\n")
      : "この先のセクションは、アプリから次の指示が届くまで始めないでください。",
  );

  return sections.join("\n");
}

/**
 * 現在フェーズを決める。
 *
 * lesson_sessions.current_phase が正。未設定なら最初のフェーズ。
 * **モデルの記憶からは決めない**（docs/REALTIME_ARCHITECTURE.md §5）。
 */
export function resolvePhase(
  phases: LessonPhase[],
  currentPhaseId: string | null,
): { phase: LessonPhase; isLastPhase: boolean } | null {
  if (phases.length === 0) return null;

  const index = currentPhaseId
    ? phases.findIndex((phase) => phase.id === currentPhaseId)
    : 0;
  // 保存されている値が教材に無い場合（教材を差し替えた等）は先頭へ戻す
  const resolvedIndex = index >= 0 ? index : 0;
  const phase = phases[resolvedIndex];
  if (!phase) return null;

  return { phase, isLastPhase: resolvedIndex === phases.length - 1 };
}
