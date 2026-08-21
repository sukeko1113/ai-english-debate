"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => void signIn("google", { callbackUrl: "/student" })}
      className="w-fit rounded bg-foreground px-4 py-2 text-background"
    >
      Google でログイン
    </button>
  );
}
