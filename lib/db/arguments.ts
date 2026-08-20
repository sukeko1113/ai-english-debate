import { query, queryOne } from "./client";
import type { ArgumentSide } from "./types";

/**
 * 生徒が作った論拠の記録（docs/DATA_MODEL.md `session_arguments`）。
 *
 * **日本語原文を上書きしない。** 英語化は en_text への追記として扱う
 * （docs/API_SPEC.md「POST /api/results/argument」）。
 * 日本語で考えてから英語にする、という授業の順序を記録に残すため。
 */

export interface SessionArgument {
  ord: number;
  side: ArgumentSide;
  jaText: string;
  enText: string | null;
}

interface ArgumentRow {
  ord: number;
  side: ArgumentSide;
  ja_text: string;
  en_text: string | null;
}

function toArgument(row: ArgumentRow): SessionArgument {
  return {
    ord: row.ord,
    side: row.side,
    jaText: row.ja_text,
    enText: row.en_text,
  };
}

/**
 * 論拠を記録する。
 *
 * 同じ日本語がすでにあれば、それを英語化の追記とみなして en_text を更新する。
 * 無ければ新しい ord で追加する。ord はサーバーが採番する
 * （ブラウザ由来の値を順番として信用しない）。
 */
export async function recordArgument(params: {
  sessionId: string;
  side: ArgumentSide;
  jaText: string;
  enText: string | null;
}): Promise<SessionArgument | null> {
  const existing = await queryOne<ArgumentRow>(
    `select ord, side, ja_text, en_text from session_arguments
      where session_id = $1 and ja_text = $2`,
    [params.sessionId, params.jaText],
  );

  if (existing) {
    // 英語が空のまま送られてきたら、すでにある英語を消さない
    if (!params.enText) return toArgument(existing);

    const updated = await queryOne<ArgumentRow>(
      `update session_arguments
          set en_text = $3,
              revision_count = revision_count + 1
        where session_id = $1 and ord = $2
        returning ord, side, ja_text, en_text`,
      [params.sessionId, existing.ord, params.enText],
    );
    return updated ? toArgument(updated) : null;
  }

  const rows = await query<ArgumentRow>(
    `insert into session_arguments (session_id, ord, side, ja_text, en_text)
     values ($1,
             coalesce((select max(ord) + 1 from session_arguments
                        where session_id = $1), 1),
             $2, $3, $4)
     returning ord, side, ja_text, en_text`,
    [params.sessionId, params.side, params.jaText, params.enText],
  );
  const row = rows[0];
  return row ? toArgument(row) : null;
}

/** 教師画面と採点で使う */
export async function getArguments(
  sessionId: string,
): Promise<SessionArgument[]> {
  const rows = await query<ArgumentRow>(
    `select ord, side, ja_text, en_text from session_arguments
      where session_id = $1 order by ord`,
    [sessionId],
  );
  return rows.map(toArgument);
}
