/**
 * ログインを許可するメールアドレスの一覧。
 *
 * docs/SECURITY.md §3「**誰でもサインアップできる状態にしない**」への対応。
 * Google ログインだけにすると Google アカウントを持つ全員が入れてしまい、
 * その全員が OpenAI の課金を使えることになる。
 *
 * 一覧は環境変数 ALLOWED_EMAILS にカンマ区切りで書く。
 *   ALLOWED_EMAILS=alice@example.com, bob@example.com
 *
 * **純粋関数にしてある。** 判定だけをテストできるようにするため。
 */

/** 比較用にそろえる。大文字小文字と前後の空白を無視する */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(normalize)
    .filter((entry) => entry.length > 0);
}

/**
 * このメールアドレスを入れてよいか。
 *
 * **一覧が空のときは誰も入れない。** 設定し忘れたまま公開されるより、
 * 誰も入れないほうが安全（fail closed）。
 */
export function isAllowed(
  email: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  if (!email) return false;
  if (allowlist.length === 0) return false;
  return allowlist.includes(normalize(email));
}

export function allowedEmailsFromEnv(): string[] {
  return parseAllowlist(process.env.ALLOWED_EMAILS);
}
