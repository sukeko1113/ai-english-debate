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
 *   - **いま扱うフェーズを明示し、先のフェーズはアプリの合図待ちとして分ける。**
 *
 * docs/REALTIME_ARCHITECTURE.md §3 からの逸脱と、その理由:
 *   §3 は「現在の step の指示だけを入れ、進んだら session.update で差し替える」
 *   としている。しかし session.update を送るのはブラウザなので、その経路に
 *   instructions を通すと、受理する答えとヒント（＝正解）が生徒に見えてしまう
 *   （docs/SECURITY.md §2「教材の正解はブラウザに送らない」）。
 *   そこで、instructions はサーバー → OpenAI の経路だけで渡し、先のフェーズも
 *   接続時にまとめて渡したうえで、**進んでよいかどうかはアプリが決める**
 *   （mark_phase_complete の返事が来るまで先へ進ませない）。
 *
 *   TODO(要確認): フェーズが増えると prompt が長くなる。本来は
 *   call_id を使ってサーバーから session.update を送るのが筋で、
 *   その経路が使えるか実接続で確認したい
 *   - **点数を言わせない。** 採点はセッション終了後にサーバー側で行う
 *     （CLAUDE.md 禁止事項2）。v03 §9 の save_lesson_result のように
 *     モデルへ点数を作らせる設計は採用しない
 */

export interface BuildInstructionsParams {
  material: LessonMaterial;
  /** 教材の全フェーズ */
  phases: LessonPhase[];
  /** アプリ側が持っている現在フェーズ（lesson_sessions.current_phase） */
  currentPhaseId: string;
}

/** v03 §4 / §11。教材によらず共通のルール */
const TEACHING_RULES = [
  "1ターンに質問は1つだけ。質問したら必ず止まり、生徒の音声回答を待つ。",
  "**正解のときは、確認を1文だけ言って、間を置かずに次の質問へ進む。**" +
    "「次に行きますか」「準備はいいですか」などと尋ねない。生徒の合図を待たない。",
  "**生徒から「次」と言われる前に、こちらから次の質問を出す。** " +
    "生徒が進行役をするのではなく、あなたが授業を進める。",
  "質問した同じターンで正解を言わない。生徒が答える前に答えを述べない。",
  "短い答えでも意味が合っていれば受け入れる。言い直しを求めない。",
  "誤答のときは、ヒント1 → ヒント2 → 正解 の順に段階的に助ける。いきなり正解を言わない。",
  "正解のあとの説明は1〜3文まで。生徒が理解した内容を繰り返し説明しない。",
  "教材にない統計・事例・新しい論拠を追加しない。教材の主張は「この立論の主張」として扱う。",
  "教材本文を書き換えない。読むときは教材のとおりに読む。",
  "点数・評価・レベル判定を口にしない。採点はアプリが行う。",
  "生徒の発話の途中で割り込まない。ただし、答え終わったらすぐ反応する。",
  "一度に話す量は短くする。長い説明をしない。テンポよく進める。",
  "生徒が「少し待って」「考えさせて」と言ったら、そのときだけ黙って待つ。",
  "説明と質問は日本語で行う。教材の英文だけは英語でゆっくり読む。",
  "生徒は日本語で答えてよい。英語を強要しない。",
  "生徒が「本文を出して」「もう一回」「ゆっくり」「日本語で」と言ったら、それに従う。",
  "いま扱っているフェーズの質問がすべて終わったら、**すぐに** mark_phase_complete を呼ぶ。" +
    "呼ぶ前に生徒へ確認を取らない。",
  "書く課題（ディクテーション・英作文）のフェーズでは、生徒が画面の回答欄へ入力する。" +
    "読み上げたあとは黙って入力を待ち、**入力される前に正解を言わない**。",
  "ディクテーションは、対象文を自然な速さで1回読む。" +
    "生徒が求めたら、意味のまとまりごとに区切ってもう一度読む。",
  "生徒が入力を終えたと言ったら record_answer を呼んで記録する。" +
    "記録は生徒が書いたそのままにする。直した版を記録しない。",
  "誤りの指摘は多くても3点まで。全部を直そうとしない。",
  "英作文では模範例をすぐ出さない。" +
    "キーワード → 文頭 → 文型 → 模範例 の順に、必要な分だけ助ける。",
  "next_phase が返ってきたら、**間を置かずに**次のフェーズの最初の質問を始める。" +
    "「では次に進みます」程度の一言でよく、区切りの挨拶を長くしない。",
  "**mark_phase_complete の返事（next_phase）が届くまで、次のフェーズを始めない。**" +
    " 返事が ok:false なら、いまのフェーズを続ける。",
  "next_phase が null なら、それ以上進まず「今日はここまで」と伝えて終わる。",
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
  const { material, phases } = params;

  const currentIndex = Math.max(
    phases.findIndex((candidate) => candidate.id === params.currentPhaseId),
    0,
  );
  const phase = phases[currentIndex];
  if (!phase) {
    throw new Error("フェーズが1つも無い教材では instructions を作れない");
  }
  const upcoming = phases.slice(currentIndex + 1);
  const isLastPhase = upcoming.length === 0;

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
    ...renderUpcoming(upcoming),
    "",
    "## いま扱うところ",
    `セクション: ${phase.section}（${phase.labelJa}）`,
    `注目する文: ${phase.focusSentence}`,
  ];

  if (phase.openingJa) {
    sections.push("", `最初に言うこと: ${phase.openingJa}`);
  }

  if (phase.guidanceJa.length > 0) {
    sections.push(
      "",
      "## このフェーズの進め方",
      phase.guidanceJa.map((line) => `- ${line}`).join("\n"),
    );
  }

  sections.push(
    "",
    "## このターンで扱う質問",
    `いま扱うフェーズの id は ${phase.id} です。`,
    phase.questions.length > 0
      ? "**下の質問を上から順に1つずつ出します。1つ質問したら必ず止まって回答を待ちます。**"
      : "このフェーズに決まった質問はありません。上の進め方に沿って、1度に1つだけ問いかけます。",
    "",
    phase.questions.map(renderQuestion).join("\n\n"),
    "",
    "## このフェーズが終わったら",
    isLastPhase
      ? [
          `全部終わったら mark_phase_complete({ phase_id: "${phase.id}" }) を呼びます。`,
          "next_phase は null が返ります。ここまでが今日の範囲です。",
          "「今日はここまでです」と伝えて終わります。",
          "生徒が続きを求めても、まだ用意ができていないことを伝えて終わります。",
        ].join("\n")
      : [
          `全部終わったら mark_phase_complete({ phase_id: "${phase.id}" }) を呼びます。`,
          "**返事が届くまで次のフェーズを始めないでください。**",
          "返事の next_phase が、次に進んでよいフェーズの id です。",
          "ok:false が返ったら進まず、いまのフェーズを続けます。",
        ].join("\n"),
  );

  return sections.join("\n");
}

/**
 * 先のフェーズをまとめて置く。**現在のフェーズより前に置く。**
 *
 * instructions が長くなるほど、末尾に近い指示のほうが効きやすい。
 * 「いま何を聞くか」と「勝手に先へ進まない」を末尾側に集めるため、
 * 先の内容はここで先に出しておく
 * （docs/REALTIME_ARCHITECTURE.md §3「長い prompt は指示の効きが落ちる」への対処）。
 */
function renderUpcoming(upcoming: LessonPhase[]): string[] {
  if (upcoming.length === 0) return [];
  return [
    "",
    "## この先のフェーズ（まだ始めない）",
    "**アプリが next_phase で名前を告げるまで、ここから先へ進まないこと。**",
    "先を読んで内容を漏らさないこと。生徒に先の質問を予告しないこと。",
    "",
    upcoming.map(renderPhase).join("\n\n"),
  ];
}

/** 先のフェーズ。順番が来たら使う */
function renderPhase(phase: LessonPhase): string {
  const lines = [
    `### フェーズ ${phase.id}（${phase.section} / ${phase.labelJa}）`,
  ];
  if (phase.focusSentence) lines.push(`注目する文: ${phase.focusSentence}`);
  if (phase.guidanceJa.length > 0) {
    lines.push(phase.guidanceJa.map((line) => `- ${line}`).join("\n"));
  }
  if (phase.questions.length > 0) {
    lines.push(phase.questions.map(renderQuestion).join("\n\n"));
  }
  return lines.join("\n");
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
