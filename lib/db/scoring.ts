import { query, queryOne, transaction } from "./client";
import type { Level } from "./types";

/**
 * 採点結果の読み書き（docs/DATA_MODEL.md「答案と採点を分離する」）。
 *
 *   session_answers（生答案・不変）
 *     → scoring_runs（いつ・何で・どの基準で採点したか）
 *     → scores（採点結果。再採点すると行が増える）
 *     → score_overrides（教員修正。scores を書き換えない）
 *
 * **scores を書き込むのは /finish と再採点だけ**（docs/API_SPEC.md）。
 *
 * TODO(要確認): docs/SECURITY.md §3 は scores への INSERT を service role
 * のみに限るとしている。いまはアプリが単一ロールで DB へ直結しているので、
 * その分離ができていない。本番のロール設計とあわせて決める。
 */

export type ScorerKind = "deterministic" | "model" | "teacher";

export interface RubricAxis {
  axis: string;
  maxScore: number;
  scorerKind: "deterministic" | "model" | "record_only" | "teacher";
  descriptors: Record<string, unknown>;
}

export interface AxisScore {
  axis: string;
  rawScore: number;
  maxScore: number;
  evidence: unknown;
}

export interface FinalAxisScore extends AxisScore {
  /** 教員修正が入っていればその点数。無ければ null */
  overriddenScore: number | null;
  overrideReason: string | null;
}

export interface Feedback {
  goodPoints: string[];
  nextGoal: string;
}

/**
 * 授業開始時に固定したルーブリックを引く。
 * 満点は表から出す。Speaking のように scorer_kind = 'record_only' の軸は
 * 合計から外す（docs/RUBRIC.md「MVP での扱い」）。
 */
export async function getRubric(
  version: string,
  level: Level,
): Promise<RubricAxis[]> {
  const rows = await query<{
    axis: string;
    max_score: string;
    scorer_kind: RubricAxis["scorerKind"];
    descriptors: Record<string, unknown>;
  }>(
    `select axis, max_score, scorer_kind, descriptors
       from rubrics where version = $1 and level = $2 order by axis`,
    [version, level],
  );

  return rows.map((row) => ({
    axis: row.axis,
    maxScore: Number(row.max_score),
    scorerKind: row.scorer_kind,
    descriptors: row.descriptors,
  }));
}

/**
 * 採点を1回ぶん書き込む。
 *
 * 同じ session の同じ scorer_kind の古い run は is_current を false にする。
 * **削除しない。** 過去の採点履歴は残す（docs/DATA_MODEL.md）。
 */
export async function saveScoringRun(params: {
  sessionId: string;
  rubricVersion: string;
  scorerKind: ScorerKind;
  scorerModel: string | null;
  scorerPromptVersion: string | null;
  scores: readonly AxisScore[];
  feedback: Feedback | null;
}): Promise<string> {
  return transaction(async (tx) => {
    await tx.query(
      `update scoring_runs set is_current = false
        where session_id = $1 and scorer_kind = $2 and is_current = true`,
      [params.sessionId, params.scorerKind],
    );

    const runRows = await tx.query<{ id: string }>(
      `insert into scoring_runs
         (session_id, rubric_version, scorer_kind, scorer_model,
          scorer_prompt_ver, is_current, feedback)
       values ($1, $2, $3, $4, $5, true, $6::jsonb)
       returning id`,
      [
        params.sessionId,
        params.rubricVersion,
        params.scorerKind,
        params.scorerModel,
        params.scorerPromptVersion,
        params.feedback === null ? null : JSON.stringify(params.feedback),
      ],
    );
    const runId = runRows[0]?.id;
    if (!runId) throw new Error("scoring_runs の作成に失敗した");

    for (const score of params.scores) {
      await tx.query(
        `insert into scores (scoring_run_id, axis, raw_score, max_score, evidence)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          runId,
          score.axis,
          score.rawScore,
          score.maxScore,
          JSON.stringify(score.evidence ?? []),
        ],
      );
    }

    return runId;
  });
}

/**
 * いま有効な採点結果。教員修正を適用した形で返す。
 * 元の scores は書き換えない（docs/DATA_MODEL.md `score_overrides`）。
 */
export async function getCurrentScores(
  sessionId: string,
): Promise<FinalAxisScore[]> {
  const rows = await query<{
    axis: string;
    raw_score: string;
    max_score: string;
    evidence: unknown;
    override_score: string | null;
    override_reason: string | null;
  }>(
    `select s.axis, s.raw_score, s.max_score, s.evidence,
            o.new_score as override_score, o.reason as override_reason
       from scoring_runs r
       join scores s on s.scoring_run_id = r.id
       left join lateral (
         select new_score, reason
           from score_overrides
          where scoring_run_id = r.id and axis = s.axis
          order by created_at desc
          limit 1
       ) o on true
      where r.session_id = $1 and r.is_current = true
      order by s.axis`,
    [sessionId],
  );

  return rows.map((row) => ({
    axis: row.axis,
    rawScore: Number(row.raw_score),
    maxScore: Number(row.max_score),
    evidence: row.evidence,
    overriddenScore:
      row.override_score === null ? null : Number(row.override_score),
    overrideReason: row.override_reason,
  }));
}

/** いま有効な run に付いている振り返りコメント */
export async function getCurrentFeedback(
  sessionId: string,
): Promise<Feedback | null> {
  const row = await queryOne<{ feedback: Feedback | null }>(
    `select feedback from scoring_runs
      where session_id = $1 and is_current = true and feedback is not null
      order by run_at desc limit 1`,
    [sessionId],
  );
  return row?.feedback ?? null;
}
