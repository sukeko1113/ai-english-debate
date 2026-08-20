import { query, queryOne } from "./client";

/**
 * Realtime 接続の記録。レート制限の判定に使う（docs/SECURITY.md §6）。
 */

/** 直近 minutes 分の接続回数。student_id は認証セッション由来のものだけ渡すこと */
export async function countRecentCalls(
  studentId: string,
  minutes: number,
): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `select count(*)::text as count
       from realtime_calls
      where student_id = $1
        and created_at > now() - make_interval(mins => $2::int)`,
    [studentId, minutes],
  );
  return Number(row?.count ?? 0);
}

export async function recordRealtimeCall(params: {
  sessionId: string;
  studentId: string;
  callId: string | null;
  model: string;
}): Promise<void> {
  await query(
    `insert into realtime_calls (session_id, student_id, call_id, model)
     values ($1, $2, $3, $4)`,
    [params.sessionId, params.studentId, params.callId, params.model],
  );
}
