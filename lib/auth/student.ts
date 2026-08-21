import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { findOrCreateStudentBySubject, getStudentById } from "../db/students";
import type { Student } from "../db/types";
import { isGoogleConfigured, authOptions } from "./options";

/**
 * 生徒の認証。
 *
 * 本番では Google ログイン（許可リスト方式。docs/SECURITY.md §3）。
 * 手元での開発は、Google の設定が無ければ開発用の固定生徒で動かす。
 *
 * 守っていること:
 *   - student_id をリクエストから受け取らない。ここでだけ確定する
 *     （CLAUDE.md 禁止事項3 / docs/SECURITY.md §2）
 *   - **本番で開発用の生徒に落ちない。** 設定が無ければ 401 にする
 */

/** supabase/seeds/dev_seed.sql の架空の生徒A */
const DEV_STUDENT_ID = "33333333-3333-4333-8333-333333333333";

export class UnauthorizedError extends Error {
  constructor(message = "未認証") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * 手元の開発で Google を設定せずに動かせるか。
 * **本番では絶対に true にしない。**
 */
export function usingDevStudent(): boolean {
  return !isProduction() && !isGoogleConfigured();
}

export async function requireStudent(): Promise<Student> {
  if (usingDevStudent()) {
    const student = await getStudentById(DEV_STUDENT_ID);
    if (!student) {
      throw new UnauthorizedError(
        "開発用の生徒が DB に無い。npm run db:apply を実行すること",
      );
    }
    return student;
  }

  if (!isGoogleConfigured()) {
    // 本番なのに設定が無い。開発用の生徒へ落ちるより止まるほうが安全
    throw new UnauthorizedError("ログインの設定がされていない");
  }

  const session = await getServerSession(authOptions);
  const subject = session?.authSubject;
  if (!subject) throw new UnauthorizedError();

  return findOrCreateStudentBySubject({
    subject,
    displayName: session.user?.name ?? "名前未設定",
    // いまある教材が Club Activities / intermediate だけなので、そこへ合わせる
    defaultLevel: "intermediate",
  });
}

/**
 * 画面（Server Component）用。未認証ならログイン画面へ送る。
 *
 * API ルートは 401 を返す必要があるので、こちらは使わず
 * requireStudent() + handleRouteError() を使う。
 */
export async function requireStudentOrRedirect(): Promise<Student> {
  try {
    return await requireStudent();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    throw error;
  }
}
