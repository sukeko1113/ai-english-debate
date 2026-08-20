import { UnauthorizedError } from "./student";

/**
 * API ルート共通のエラー応答。
 *
 * docs/API_SPEC.md の共通ルール:
 *   - 未認証は 401
 *   - 他人のリソースは 404（403 にしない。存在を漏らさない）
 *   - **エラーレスポンスに内部情報を含めない**
 */

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export function notFound(): Response {
  return jsonError(404, "見つかりません");
}

/**
 * ルートの中で投げられた例外を応答へ変換する。
 * 想定外の例外はサーバーログにだけ残し、クライアントには汎用メッセージを返す。
 */
export function handleRouteError(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    return jsonError(401, "ログインが必要です");
  }
  console.error("[api] 想定外のエラー", error);
  return jsonError(500, "サーバーエラーが発生しました");
}
