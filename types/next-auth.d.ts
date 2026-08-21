import "next-auth";
import "next-auth/jwt";

/**
 * セッションに載せる追加項目。
 * authSubject は「プロバイダ名:sub」で、students.auth_subject と対応する。
 * **メールアドレスを鍵にしない**（Google 側でメールが変わっても同じ人と分かるように）。
 */
declare module "next-auth" {
  interface Session {
    authSubject?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    authSubject?: string;
  }
}
