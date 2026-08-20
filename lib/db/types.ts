/**
 * DB の行に対応するドメイン型。
 *
 * ここと lib/db/*.ts の外へ、DB クライアント（pg / Supabase）の型を漏らさない。
 * 将来 GCP 等へ移す場合に差し替えるのは lib/db/ の中だけで済むようにする。
 * （CLAUDE.md「Supabase 固有機能に深く依存しない」）
 */

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

export const QUESTION_TYPES = [
  "dictation",
  "comprehension",
  "writing",
  "vocabulary",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** ディベートでどちら側に立つか。教材側の語彙 */
export type DebateSide = "for" | "against";

/** 生徒が選んだ立場。session_arguments の語彙 */
export type ArgumentSide = "agree" | "disagree";

/** 書き起こしの話者（0001_init.sql の check 制約に合わせる） */
export const SPEAKERS = ["student", "tutor"] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const SESSION_STATUSES = [
  "in_progress",
  "scoring",
  "finished",
  "abandoned",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * 教材側は for/against、生徒の記録側は agree/disagree と語彙が分かれている
 * （0001_init.sql の debate_tasks.side と session_arguments.side）。
 * 変換をここ1か所に閉じる。
 *
 * TODO(要確認): 本来はどちらかの語彙に統一したい。既存 migration を書き換えない
 * 方針のため、当面は変換で吸収する。
 */
export function toDebateSide(side: ArgumentSide): DebateSide {
  return side === "agree" ? "for" : "against";
}

export function toArgumentSide(side: DebateSide): ArgumentSide {
  return side === "for" ? "agree" : "disagree";
}

export interface Student {
  id: string;
  classId: string | null;
  displayName: string;
  currentLevel: Level;
}

export interface Topic {
  id: string;
  code: string;
  titleEn: string;
  titleJa: string;
  category: string | null;
}

export interface VocabularyItem {
  word: string;
  meaning: string;
  example: string | null;
}

export interface GrammarPoint {
  point: string;
  explanation: string;
  examples: string[];
}

/**
 * 生徒のブラウザへ送ってよい問題。
 * **answer を持たない**（docs/API_SPEC.md「questions に answer を含めない」）。
 */
export interface PublicQuestion {
  id: string;
  key: string;
  type: QuestionType;
  prompt: string;
  maxScore: number;
}

/** 採点用。サーバー内でのみ扱う */
export interface QuestionWithAnswer extends PublicQuestion {
  answer: string | null;
  answerNote: string | null;
}

export interface DebateTask {
  id: string;
  side: DebateSide;
  prompt: string;
  constraints: Record<string, unknown>;
  hintTopics: string[];
}

export interface Counterargument {
  againstSide: DebateSide;
  text: string;
}

/**
 * 授業画面とモデルへ渡す教材一式。
 * answer / model_answers / teacher_note を含まないので、そのまま
 * クライアントへ返してよい。
 */
export interface LessonMaterial {
  materialId: string;
  level: Level;
  version: string;
  topic: Topic;
  objectives: string[];
  script: string;
  vocabulary: VocabularyItem[];
  grammarPoints: GrammarPoint[];
  questions: PublicQuestion[];
  debateTasks: DebateTask[];
  counterarguments: Counterargument[];
  /** 進行の目安表示用。質問文と正解は含まない */
  phases: PublicPhase[];
}

/**
 * 授業フェーズ（AI教師プロンプト v03 §6 の状態遷移）。
 *
 * **accept と hints は正解にあたる。ブラウザへ送らない。**
 * モデルへは session instructions 経由でのみ渡す。
 */
export interface PhaseQuestion {
  key: string;
  askJa: string;
  accept: string[];
  hints: string[];
  confirmJa: string;
}

export interface LessonPhase {
  id: string;
  section: string;
  labelJa: string;
  focusSentence: string;
  openingJa: string | null;
  /** 一問一答にならないフェーズ（論拠作成・ディベートなど）の進め方 */
  guidanceJa: string[];
  questions: PhaseQuestion[];
}

/** ブラウザへ返してよいフェーズ情報。質問文も正解も含まない */
export interface PublicPhase {
  id: string;
  section: string;
  labelJa: string;
  /**
   * いま読んでいる文。本文の一部なので生徒に見せてよい。
   * 画面で本文のどこを扱っているかを示すために使う。
   * **accept や hints（正解）は含めない。**
   */
  focusSentence: string;
}

/** 授業開始時に lesson_sessions へ固定する版（docs/RUBRIC.md） */
export interface MaterialVersions {
  materialId: string;
  level: Level;
  rubricVersion: string;
  promptVersion: string;
}

export interface LessonSession {
  id: string;
  studentId: string;
  materialId: string;
  rubricVersion: string;
  promptVersion: string;
  currentStep: number;
  /** v03 プロンプトの状態名。未設定なら教材の最初のフェーズとして扱う */
  currentPhase: string | null;
  status: SessionStatus;
  startedAt: Date;
  finishedAt: Date | null;
}
