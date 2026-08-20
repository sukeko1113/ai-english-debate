import { query, queryOne } from "./client";
import type {
  Counterargument,
  DebateTask,
  GrammarPoint,
  LessonMaterial,
  Level,
  PublicQuestion,
  QuestionWithAnswer,
  QuestionType,
  Topic,
  VocabularyItem,
} from "./types";

/**
 * 教材の取得。
 *
 * 生徒へ返す経路（getLessonMaterial）と、採点で使う経路
 * （getQuestionsWithAnswers）を型のレベルで分ける。
 * 正解をブラウザへ送らないため（docs/API_SPEC.md / docs/SECURITY.md §2）。
 */

interface MaterialRow {
  material_id: string;
  level: Level;
  version: string;
  script: string;
  objectives: string[];
  topic_id: string;
  code: string;
  title_en: string;
  title_ja: string;
  category: string | null;
}

interface VocabularyRow {
  word: string;
  meaning: string;
  example: string | null;
}

interface GrammarRow {
  point: string;
  explanation: string;
  examples: string[];
}

interface PublicQuestionRow {
  id: string;
  key: string;
  type: QuestionType;
  prompt: string;
  max_score: string | number;
}

interface QuestionWithAnswerRow extends PublicQuestionRow {
  answer: string | null;
  answer_note: string | null;
}

interface DebateTaskRow {
  id: string;
  side: "for" | "against";
  prompt: string;
  constraints: Record<string, unknown>;
  hint_topics: string[];
}

interface CounterargumentRow {
  against_side: "for" | "against";
  text: string;
}

function toPublicQuestion(row: PublicQuestionRow): PublicQuestion {
  return {
    id: row.id,
    key: row.key,
    type: row.type,
    prompt: row.prompt,
    maxScore: Number(row.max_score),
  };
}

/** 教材 ID から、生徒へ返してよい教材一式を組み立てる */
export async function getLessonMaterial(
  materialId: string,
): Promise<LessonMaterial | null> {
  const material = await queryOne<MaterialRow>(
    `select m.id as material_id, m.level, m.version, m.script, m.objectives,
            t.id as topic_id, t.code, t.title_en, t.title_ja, t.category
       from materials m
       join topics t on t.id = m.topic_id
      where m.id = $1`,
    [materialId],
  );
  if (!material) return null;

  const [vocabulary, grammar, questions, debateTasks, counterarguments] =
    await Promise.all([
      query<VocabularyRow>(
        `select word, meaning, example
           from vocabulary where material_id = $1 order by ord`,
        [materialId],
      ),
      query<GrammarRow>(
        `select point, explanation, examples
           from grammar_points where material_id = $1 order by ord`,
        [materialId],
      ),
      // answer / answer_note を select しない
      query<PublicQuestionRow>(
        `select id, key, type, prompt, max_score
           from questions where material_id = $1 order by ord`,
        [materialId],
      ),
      query<DebateTaskRow>(
        `select id, side, prompt, constraints, hint_topics
           from debate_tasks where topic_id = $1 and level = $2 order by side`,
        [material.topic_id, material.level],
      ),
      query<CounterargumentRow>(
        `select against_side, text
           from ai_counterarguments
          where topic_id = $1 and level = $2 order by against_side, ord`,
        [material.topic_id, material.level],
      ),
    ]);

  const topic: Topic = {
    id: material.topic_id,
    code: material.code,
    titleEn: material.title_en,
    titleJa: material.title_ja,
    category: material.category,
  };

  return {
    materialId: material.material_id,
    level: material.level,
    version: material.version,
    topic,
    objectives: material.objectives,
    script: material.script,
    vocabulary: vocabulary satisfies VocabularyItem[],
    grammarPoints: grammar satisfies GrammarPoint[],
    questions: questions.map(toPublicQuestion),
    debateTasks: debateTasks.map(
      (row): DebateTask => ({
        id: row.id,
        side: row.side,
        prompt: row.prompt,
        constraints: row.constraints,
        hintTopics: row.hint_topics,
      }),
    ),
    counterarguments: counterarguments.map(
      (row): Counterargument => ({
        againstSide: row.against_side,
        text: row.text,
      }),
    ),
  };
}

/** テーマコードとレベルから教材 ID を引く（開発・テスト用） */
export async function findMaterialId(
  topicCode: string,
  level: Level,
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `select m.id
       from materials m
       join topics t on t.id = m.topic_id
      where t.code = $1 and m.level = $2
      order by m.version desc
      limit 1`,
    [topicCode, level],
  );
  return row?.id ?? null;
}

/**
 * 正解を含む問題一覧。**採点でのみ使う。**
 * この戻り値をレスポンスへそのまま入れないこと。
 */
export async function getQuestionsWithAnswers(
  materialId: string,
): Promise<QuestionWithAnswer[]> {
  const rows = await query<QuestionWithAnswerRow>(
    `select id, key, type, prompt, max_score, answer, answer_note
       from questions where material_id = $1 order by ord`,
    [materialId],
  );
  return rows.map((row) => ({
    ...toPublicQuestion(row),
    answer: row.answer,
    answerNote: row.answer_note,
  }));
}

/**
 * question_id がその授業の教材に属するかを確認する。
 * ブラウザから来た item_id をそのまま保存しないため
 * （docs/REALTIME_ARCHITECTURE.md §1）。
 */
export async function questionBelongsToMaterial(
  questionId: string,
  materialId: string,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select id from questions where id = $1 and material_id = $2`,
    [questionId, materialId],
  );
  return row !== null;
}
