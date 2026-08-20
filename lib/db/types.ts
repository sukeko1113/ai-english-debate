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
}

export interface LessonSession {
  id: string;
  studentId: string;
  materialId: string;
  rubricVersion: string;
  promptVersion: string;
  currentStep: number;
  status: SessionStatus;
  startedAt: Date;
  finishedAt: Date | null;
}
