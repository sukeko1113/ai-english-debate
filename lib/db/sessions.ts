import { query, queryOne } from "./client";
import type { LessonSession, SessionStatus } from "./types";

/**
 * lesson_sessions の読み書き。
 *
 * 授業の進行状態はここが正。モデルの記憶に依存しない
 * （docs/REALTIME_ARCHITECTURE.md §5）。
 *
 * **すべての取得関数は student_id を必須にしている。** session_id だけで
 * 引ける関数を作らないことで、所有者検証の抜けを起こしにくくする
 * （docs/SECURITY.md §2）。
 */

interface SessionRow {
  id: string;
  student_id: string;
  material_id: string;
  rubric_version: string;
  prompt_version: string;
  current_step: number;
  status: SessionStatus;
  started_at: Date;
  finished_at: Date | null;
}

function toSession(row: SessionRow): LessonSession {
  return {
    id: row.id,
    studentId: row.student_id,
    materialId: row.material_id,
    rubricVersion: row.rubric_version,
    promptVersion: row.prompt_version,
    currentStep: row.current_step,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const SESSION_COLUMNS = `id, student_id, material_id, rubric_version,
                         prompt_version, current_step, status,
                         started_at, finished_at`;

/**
 * 所有者を確認したうえでセッションを引く。
 * 他人のセッションなら null。呼び出し側は 404 を返すこと
 * （403 だと存在が漏れる。docs/API_SPEC.md）。
 */
export async function findOwnedSession(
  sessionId: string,
  studentId: string,
): Promise<LessonSession | null> {
  const row = await queryOne<SessionRow>(
    `select ${SESSION_COLUMNS} from lesson_sessions
      where id = $1 and student_id = $2`,
    [sessionId, studentId],
  );
  return row ? toSession(row) : null;
}

/** 未完了の同一教材セッション。あれば新規作成せずこれを使う */
export async function findUnfinishedSession(
  studentId: string,
  materialId: string,
): Promise<LessonSession | null> {
  const row = await queryOne<SessionRow>(
    `select ${SESSION_COLUMNS} from lesson_sessions
      where student_id = $1 and material_id = $2 and status = 'in_progress'
      order by started_at desc
      limit 1`,
    [studentId, materialId],
  );
  return row ? toSession(row) : null;
}

/**
 * 授業を開始する。rubric_version と prompt_version をここで固定する
 * （docs/DATA_MODEL.md `lesson_sessions`）。
 * 未完了のセッションがあればそれを返す。
 */
export async function startLessonSession(params: {
  studentId: string;
  materialId: string;
  rubricVersion: string;
  promptVersion: string;
}): Promise<LessonSession> {
  const existing = await findUnfinishedSession(
    params.studentId,
    params.materialId,
  );
  if (existing) return existing;

  const rows = await query<SessionRow>(
    `insert into lesson_sessions
       (student_id, material_id, rubric_version, prompt_version)
     values ($1, $2, $3, $4)
     returning ${SESSION_COLUMNS}`,
    [
      params.studentId,
      params.materialId,
      params.rubricVersion,
      params.promptVersion,
    ],
  );

  const row = rows[0];
  if (!row) throw new Error("lesson_sessions の作成に失敗した");
  return toSession(row);
}

/**
 * ステップ通過を記録して current_step を1つ進める。
 *
 * current_step が completedStep と一致しない場合は **進めない**。
 * モデルがステップを飛ばそうとしても、アプリ側の状態は動かさない
 * （docs/LESSON_FLOW.md「ステップ遷移の実装」）。
 *
 * 戻り値は現在の current_step。進んだかどうかは advanced で判断する。
 */
export async function completeStep(
  sessionId: string,
  studentId: string,
  completedStep: number,
): Promise<{ advanced: boolean; currentStep: number }> {
  const session = await findOwnedSession(sessionId, studentId);
  if (!session) throw new Error("セッションが見つからない");

  if (session.currentStep !== completedStep) {
    return { advanced: false, currentStep: session.currentStep };
  }

  await query(
    `insert into session_steps (session_id, step_no)
     values ($1, $2)
     on conflict (session_id, step_no) do nothing`,
    [sessionId, completedStep],
  );

  const rows = await query<{ current_step: number }>(
    `update lesson_sessions
        set current_step = least(current_step + 1, 9)
      where id = $1 and student_id = $2 and current_step = $3
      returning current_step`,
    [sessionId, studentId, completedStep],
  );

  const row = rows[0];
  if (!row) return { advanced: false, currentStep: session.currentStep };
  return { advanced: true, currentStep: row.current_step };
}

/** 授業の状態を変える。採点の開始・終了で使う */
export async function setSessionStatus(
  sessionId: string,
  status: SessionStatus,
): Promise<void> {
  await query(
    `update lesson_sessions
        set status = $2,
            finished_at = case when $2 in ('finished','abandoned')
                               then coalesce(finished_at, now())
                               else finished_at end
      where id = $1`,
    [sessionId, status],
  );
}
