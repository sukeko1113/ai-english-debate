import type { AxisScore, Feedback, RubricAxis } from "../db/scoring";

/**
 * モデル採点（docs/RUBRIC.md「モデル採点」）。
 *
 * **セッション中には呼ばない。** 終了後に、書き起こしと答案から採点する
 * （CLAUDE.md 禁止事項2）。
 *
 * このファイルは組み立てと検証だけを持ち、通信は lib/openai/client.ts に置く
 * （OPENAI_API_KEY を読んでよいのはそこだけ）。
 */

export interface ScorerAnswer {
  questionKey: string;
  questionPrompt: string;
  answerText: string;
  attemptNo: number;
}

export interface ScorerTranscriptLine {
  speaker: "student" | "tutor";
  text: string;
  startedAtMs: number;
}

export interface ScorerInput {
  rubricVersion: string;
  level: string;
  topicTitle: string;
  script: string;
  /** 採点する軸だけ。record_only の軸は入れない */
  axes: { axis: string; maxScore: number; descriptor: string }[];
  answers: ScorerAnswer[];
  transcript: ScorerTranscriptLine[];
}

/** 採点器へ渡す固定の指示 */
export const SCORER_INSTRUCTIONS = [
  "You grade a Japanese high-school English debate lesson.",
  "Return JSON only. No prose outside the JSON object.",
  "",
  "Rules:",
  "1. Grade only the axes given in `axes`. Do not invent axes.",
  "2. raw_score must be an integer between 0 and the axis max_score.",
  "3. `evidence` is required for every axis: quote what the student actually",
  "   said or wrote. A teacher must be able to check your judgement.",
  "4. Judge against the level's descriptor, not against native-speaker English.",
  "5. If there is not enough material to judge an axis, give a low score and",
  "   say so in the evidence. Do not guess.",
  "6. `feedback.good_points` は2つ、`feedback.next_goal` は1つ、日本語で書く。",
  "",
  "Output shape:",
  '{"axes":[{"axis":"reasoning","raw_score":14,"evidence":["..."]}],',
  ' "feedback":{"good_points":["..."],"next_goal":"..."}}',
].join("\n");

/** 採点対象になる軸だけを取り出す（record_only は除く） */
export function scorableAxes(rubric: readonly RubricAxis[]): RubricAxis[] {
  return rubric.filter((axis) => axis.scorerKind === "model");
}

/** 採点器へ渡す JSON。教材と答案と書き起こしをそのまま入れる */
export function buildScorerInput(input: ScorerInput): string {
  return JSON.stringify(
    {
      rubric_version: input.rubricVersion,
      level: input.level,
      topic: input.topicTitle,
      script: input.script,
      axes: input.axes.map((axis) => ({
        axis: axis.axis,
        max_score: axis.maxScore,
        descriptor: axis.descriptor,
      })),
      answers: input.answers.map((answer) => ({
        question_key: answer.questionKey,
        prompt: answer.questionPrompt,
        answer_text: answer.answerText,
        attempt_no: answer.attemptNo,
      })),
      transcript: input.transcript.map((line) => ({
        speaker: line.speaker,
        text: line.text,
        started_at_ms: line.startedAtMs,
      })),
    },
    null,
    2,
  );
}

export interface ParsedScoring {
  scores: AxisScore[];
  feedback: Feedback | null;
}

/**
 * 採点器の出力を検証して取り込む。
 *
 * **信用しない。** 知らない軸、範囲外の点数、根拠の無い軸は捨てる。
 * 捨てた軸は結果に現れないので、呼び出し側が欠けに気づける。
 */
export function parseScorerOutput(
  raw: string,
  axes: readonly RubricAxis[],
): ParsedScoring | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;

  const record = payload as Record<string, unknown>;
  const rawAxes = record.axes;
  if (!Array.isArray(rawAxes)) return null;

  const byName = new Map(axes.map((axis) => [axis.axis, axis]));
  const scores: AxisScore[] = [];

  for (const entry of rawAxes) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;

    const axisName = item.axis;
    if (typeof axisName !== "string") continue;
    const axis = byName.get(axisName);
    if (!axis) continue;

    const rawScore = item.raw_score;
    if (
      typeof rawScore !== "number" ||
      !Number.isFinite(rawScore) ||
      rawScore < 0 ||
      rawScore > axis.maxScore
    ) {
      continue;
    }

    // 根拠が無い採点は採らない（docs/RUBRIC.md「evidence を必須にする」）
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.filter(
          (line): line is string =>
            typeof line === "string" && line.trim().length > 0,
        )
      : [];
    if (evidence.length === 0) continue;

    scores.push({
      axis: axis.axis,
      rawScore: Math.round(rawScore),
      maxScore: axis.maxScore,
      evidence,
    });
  }

  return { scores, feedback: parseFeedback(record.feedback) };
}

function parseFeedback(value: unknown): Feedback | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  const goodPoints = Array.isArray(record.good_points)
    ? record.good_points.filter(
        (line): line is string =>
          typeof line === "string" && line.trim().length > 0,
      )
    : [];
  const nextGoal =
    typeof record.next_goal === "string" ? record.next_goal.trim() : "";

  if (goodPoints.length === 0 && nextGoal.length === 0) return null;
  return { goodPoints, nextGoal };
}
