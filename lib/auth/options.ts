import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { allowedEmailsFromEnv, isAllowed } from "./allowlist";

/**
 * Google ログインの設定（docs/SECURITY.md §3）。
 *
 * - 許可リストに載っているメールアドレスだけ入れる
 * - セッションには「プロバイダ名:sub」を入れる。**メールを鍵にしない**
 *   （Google 側でメールが変わっても同じ人と分かるようにするため）
 * - 生徒の DB 行はここでは作らない。requireStudent() が作る
 */

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ user }) {
      // ここで弾くと、許可リスト外の人はセッションを持てない
      return isAllowed(user.email, allowedEmailsFromEnv());
    },
    jwt({ token, account }) {
      if (account?.provider && account.providerAccountId) {
        token.authSubject = `${account.provider}:${account.providerAccountId}`;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.authSubject === "string") {
        session.authSubject = token.authSubject;
      }
      return session;
    },
  },
};
