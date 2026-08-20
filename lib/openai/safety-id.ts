import { createHash } from "node:crypto";

/**
 * OpenAI へ送る Safety Identifier。
 *
 * **生の学籍番号・氏名を送らない**（docs/SECURITY.md §4）。
 * 生徒ごとに安定した値であればよいので、ソルト付きハッシュにする。
 *
 * 後から追加すると過去セッションと紐づかないため、初回実装から必ず付ける
 * （docs/REALTIME_ARCHITECTURE.md §2）。
 */
export function safetyIdFor(studentId: string): string {
  const salt = process.env.SAFETY_ID_SALT;
  if (!salt) {
    throw new Error("SAFETY_ID_SALT が設定されていない");
  }
  return createHash("sha256").update(`${studentId}${salt}`).digest("hex");
}
