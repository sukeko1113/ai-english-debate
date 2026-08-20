import { handleRouteError, notFound } from "@/lib/auth/respond";
import { requireStudent } from "@/lib/auth/student";
import { getLessonMaterial, getQuestionsWithAnswers } from "@/lib/db/materials";
import {
  getRubric,
  saveScoringRun,
  type AxisScore,
  type RubricAxis,
} from "@/lib/db/scoring";
import { findOwnedSession, setSessionStatus } from "@/lib/db/sessions";
import type { LessonSession } from "@/lib/db/types";
import { getTranscript } from "@/lib/db/transcript";
import { query } from "@/lib/db/client";
import {
  createScoringCompletion,
  getScorerModel,
  getScorerPromptVersion,
} from "@/lib/openai/client";
import {
  DICTATION_MAX_SCORE,
  scoreDictationSet,
  selectScoredAttempt,
  type DictationItem,
  type RecordedAnswer,
} from "@/lib/scoring/deterministic";
import {
  SCORER_INSTRUCTIONS,
  buildScorerInput,
  parseScorerOutput,
  scorableAxes,
} from "@/lib/scoring/model";

/**
 * POST /api/lesson-sessions/:id/finish — 授業を終了し、採点を実行する。
 *
 * docs/RUBRIC.md「採点の実行タイミング」:
 *   status = 'scoring' → 確定採点（同期・速い） → モデル採点 →
 *   scoring_runs + scores → status = 'finished'
 *
 * **モデル採点が失敗しても、確定採点の結果は残る。**
 *
 * ここは scores を書き込む唯一の入口（再採点を除く）。
 * 点数はサーバーが計算する。ブラウザからもモデルからも受け取らない
 * （CLAUDE.md 禁止事項2）。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const student = await requireStudent();
    const { id } = await context.params;

    const session = await findOwnedSession(id, student.id);
    if (!session) return notFound();

    await setSessionStatus(session.id, "scoring");

    const rubric = await getRubric(session.rubricVersion, await levelOf(session));

    // 1. 確定採点（同期）
    const deterministic = await runDeterministic(session, rubric);

    // 2. モデル採点（失敗しても確定採点は残す）
    const modelScored = await runModelScoring(session, rubric).catch(
      (error: unknown) => {
        console.error("[finish] モデル採点に失敗した", error);
        return false;
      },
    );

    await setSessionStatus(session.id, "finished");

    return Response.json({
      ok: true,
      status: "finished",
      deterministic,
      modelScored,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function levelOf(session: LessonSession) {
  const material = await getLessonMaterial(session.materialId);
  if (!material) throw new Error("教材が見つからない");
  return material.level;
}

/** ディクテーションの文字列照合。AI を使わない */
async function runDeterministic(
  session: LessonSession,
  rubric: readonly RubricAxis[],
): Promise<boolean> {
  const axis = rubric.find((entry) => entry.axis === "language_accuracy");
  if (!axis) return false;

  const questions = await getQuestionsWithAnswers(session.materialId);
  const answers = await query<{
    question_id: string;
    attempt_no: number;
    answer_text: string;
  }>(
    `select question_id, attempt_no, answer_text
       from session_answers where session_id = $1`,
    [session.id],
  );
  const recorded: RecordedAnswer[] = answers.map((row) => ({
    questionId: row.question_id,
    attemptNo: row.attempt_no,
    answerText: row.answer_text,
  }));

  const items: DictationItem[] = [];
  for (const question of questions) {
    if (question.type !== "dictation" || question.answer === null) continue;
    // 最初の試行を採点する（教員と確認済み）。
    // 未回答も分母に数える。飛ばした方が得になってはいけない
    const attempt = selectScoredAttempt(recorded, question.id);
    items.push({
      key: question.key,
      answerText: attempt?.answerText ?? null,
      expected: question.answer,
    });
  }

  const result = scoreDictationSet(items);
  if (!result.applicable) {
    // ディクテーションが無い教材。確定採点の分は付けない
    return false;
  }

  const score: AxisScore = {
    axis: axis.axis,
    rawScore: result.rawScore,
    maxScore: DICTATION_MAX_SCORE,
    evidence: result.evidence,
  };

  await saveScoringRun({
    sessionId: session.id,
    rubricVersion: session.rubricVersion,
    scorerKind: "deterministic",
    scorerModel: null,
    scorerPromptVersion: null,
    scores: [score],
    feedback: null,
  });
  return true;
}

/** 書き起こしと答案からモデルに採点させる */
async function runModelScoring(
  session: LessonSession,
  rubric: readonly RubricAxis[],
): Promise<boolean> {
  const axes = scorableAxes(rubric);
  if (axes.length === 0) return false;

  const material = await getLessonMaterial(session.materialId);
  if (!material) return false;

  const questions = await getQuestionsWithAnswers(session.materialId);
  const byId = new Map(questions.map((question) => [question.id, question]));

  const answerRows = await query<{
    question_id: string;
    attempt_no: number;
    answer_text: string;
  }>(
    `select question_id, attempt_no, answer_text
       from session_answers where session_id = $1 order by recorded_at`,
    [session.id],
  );

  const transcript = await getTranscript(session.id);

  const input = buildScorerInput({
    rubricVersion: session.rubricVersion,
    level: material.level,
    topicTitle: material.topic.titleEn,
    script: material.script,
    axes: axes.map((axis) => ({
      axis: axis.axis,
      maxScore: axis.maxScore,
      descriptor: String(axis.descriptors.full_marks ?? ""),
    })),
    answers: answerRows.map((row) => ({
      questionKey: byId.get(row.question_id)?.key ?? row.question_id,
      questionPrompt: byId.get(row.question_id)?.prompt ?? "",
      answerText: row.answer_text,
      attemptNo: row.attempt_no,
    })),
    transcript: transcript.map((line) => ({
      speaker: line.speaker,
      text: line.text,
      startedAtMs: line.startedAtMs,
    })),
  });

  const model = getScorerModel();
  const raw = await createScoringCompletion({
    instructions: SCORER_INSTRUCTIONS,
    input,
    model,
  });

  const parsed = parseScorerOutput(raw, axes);
  if (!parsed || parsed.scores.length === 0) {
    console.error("[finish] 採点器の出力を採用できなかった");
    return false;
  }

  await saveScoringRun({
    sessionId: session.id,
    rubricVersion: session.rubricVersion,
    scorerKind: "model",
    scorerModel: model,
    scorerPromptVersion: getScorerPromptVersion(),
    scores: parsed.scores,
    feedback: parsed.feedback,
  });
  return true;
}
