"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/login" })}
      className="rounded border border-black/20 px-2 py-1 text-xs dark:border-white/25"
    >
      ログアウト
    </button>
  );
}
