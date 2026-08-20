"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * 「AI授業を開始」。POST /api/lesson-sessions を呼んで授業画面へ移る。
 *
 * lessonSessionId はサーバーが発行する。クライアントが決めない。
 */
export function StartLessonButton({
  materialId,
  hasExistingSession,
}: {
  materialId: string;
  hasExistingSession: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/lesson-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId }),
      });
      if (!response.ok) {
        setError("授業を開始できませんでした");
        return;
      }
      router.push(`/student/lesson/${materialId}`);
    } catch {
      setError("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {hasExistingSession ? "続きから始める" : "AI授業を開始"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
