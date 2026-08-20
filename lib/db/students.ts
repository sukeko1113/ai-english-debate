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
