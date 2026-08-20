import { getStudentById } from "../db/students";
import type { Student } from "../db/types";

/**
 * 生徒の認証。**現時点は仮実装。**
 *
 * TODO(要確認): 本実装をどうするか決まっていない（docs/SECURITY.md §3）。
 *   - 学校アカウント（Google Workspace / Microsoft Entra ID）の OAuth か
 *   - メール + パスワードも用意するか
 *   - クラス招待コードを必須にする方法（誰でもサインアップできる状態にしない）
 * 決まるまで、開発用の固定生徒を返す。
 *
 * 守っていること:
 *   - student_id をリクエストから受け取らない。ここでだけ確定する
 *     （CLAUDE.md 禁止事項3 / docs/SECURITY.md §2）
 *   - 本番ビルドでは必ず失敗する。仮実装のまま生徒データに触れさせない
 */

/** supabase/seeds/dev_seed.sql の架空の生徒A */
const DEV_STUDENT_ID = "33333333-3333-4333-8333-333333333333";

export class UnauthorizedError extends Error {
  constructor(message = "未認証") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function requireStudent(): Promise<Student> {
  if (process.env.NODE_ENV === "production") {
    // 仮実装を本番へ出さないための安全弁。認証を実装するまで外さないこと
    throw new Error("認証が未実装のため本番では使えない");
  }

  const student = await getStudentById(DEV_STUDENT_ID);
  if (!student) {
    throw new UnauthorizedError(
      "開発用の生徒が DB に無い。npm run db:local を実行すること",
    );
  }
  return student;
}
