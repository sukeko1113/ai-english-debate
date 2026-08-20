import { query } from "./client";

/**
 * 生答案の記録（docs/DATA_MODEL.md `session_answers`）。
 *
 * **採点しない。** session_answers に score カラムは無く、ここでも正誤を持たない。
 * 採点はセッション終了後に scoring_runs / scores へ書く。
 */

export interface RecordAnswerParams {
  sessionId: string;
  questionId: string;
  attemptNo: number;
  /** 生徒が言った・書いたそのまま。モデルに直させた版ではない */
  answerText: string;
}

/**
 * 答案を保存する。同じ (session, question, attempt) が既にあれば何もしない。
 * 再接続時の二重記録を防ぐため（docs/REALTIME_ARCHITECTURE.md §7）。
 */
export async function recordAnswer(params: RecordAnswerParams): Promise<void> {
  await query(
    `insert into session_answers
       (session_id, question_id, attempt_no, answer_text)
     values ($1, $2, $3, $4)
     on conflict (session_id, question_id, attempt_no) do nothing`,
    [params.sessionId, params.questionId, params.attemptNo, params.answerText],
  );
}
