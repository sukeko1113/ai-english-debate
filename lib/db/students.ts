import { queryOne } from "./client";
import type { Level, Student } from "./types";

interface StudentRow {
  id: string;
  class_id: string | null;
  display_name: string;
  current_level: Level;
}

function toStudent(row: StudentRow): Student {
  return {
    id: row.id,
    classId: row.class_id,
    displayName: row.display_name,
    currentLevel: row.current_level,
  };
}

/**
 * 生徒を ID で引く。
 *
 * **ここへ渡す ID は認証セッションから来たものだけ。** リクエストボディの
 * student_id を渡さないこと（CLAUDE.md 禁止事項3 / docs/SECURITY.md §2）。
 */
export async function getStudentById(id: string): Promise<Student | null> {
  const row = await queryOne<StudentRow>(
    `select id, class_id, display_name, current_level
       from students where id = $1`,
    [id],
  );
  return row ? toStudent(row) : null;
}

/**
 * 外部の認証プロバイダのユーザーに対応する生徒を返す。無ければ作る。
 *
 * subject は「プロバイダ名:sub」。**メールアドレスを鍵にしない**
 * （Google 側でメールが変わっても同じ人と分かるようにするため）。
 *
 * 表示名は Google の名前をそのまま入れる。学籍番号は結び付けない
 * （docs/SECURITY.md §4「氏名は表示名のみ」）。
 */
export async function findOrCreateStudentBySubject(params: {
  subject: string;
  displayName: string;
  /** 今ある教材に合わせる。当面 Club Activities は intermediate のみ */
  defaultLevel: Level;
}): Promise<Student> {
  const existing = await queryOne<StudentRow>(
    `select id, class_id, display_name, current_level
       from students where auth_subject = $1`,
    [params.subject],
  );
  if (existing) return toStudent(existing);

  const created = await queryOne<StudentRow>(
    `insert into students (auth_subject, display_name, current_level)
     values ($1, $2, $3)
     on conflict (auth_subject) do update set display_name = excluded.display_name
     returning id, class_id, display_name, current_level`,
    [params.subject, params.displayName, params.defaultLevel],
  );
  if (!created) throw new Error("生徒の作成に失敗した");
  return toStudent(created);
}

/** 認証基盤のユーザー ID から引く。本実装の認証で使う */
export async function getStudentByAuthUserId(
  authUserId: string,
): Promise<Student | null> {
  const row = await queryOne<StudentRow>(
    `select id, class_id, display_name, current_level
       from students where auth_user_id = $1`,
    [authUserId],
  );
  return row ? toStudent(row) : null;
}
