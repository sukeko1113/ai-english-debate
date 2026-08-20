"use client";

import { useRealtimeSession, type VoiceStatus } from "./useRealtimeSession";

/**
 * 授業画面の下部にある音声操作（docs/BASIC_DESIGN_v03.md §3.2「下部」）。
 * 「開始」「停止」とマイク状態表示。
 *
 * ヒントと終了は Task 6 以降。まだ無効にしておく。
 */

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "停止中",
  "requesting-mic": "マイクを確認中…",
  connecting: "接続中…",
  connected: "接続中（話しかけてください）",
  error: "エラー",
};

const STATUS_COLOR: Record<VoiceStatus, string> = {
  idle: "bg-black/30 dark:bg-white/30",
  "requesting-mic": "bg-amber-500",
  connecting: "bg-amber-500",
  connected: "bg-green-600",
  error: "bg-red-600",
};

export function VoiceControls({
  lessonSessionId,
}: {
  lessonSessionId: string | null;
}) {
  const { status, error, audioRef, start, stop } =
    useRealtimeSession(lessonSessionId);

  const running = status === "connected" || status === "connecting";

  return (
    <footer className="flex flex-col gap-2 border-t border-black/10 p-3 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void start()}
          disabled={running || lessonSessionId === null}
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40"
        >
          開始
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!running}
          className="rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/25"
        >
          停止
        </button>

        <span className="flex items-center gap-2 text-sm" aria-live="polite">
          <span
            aria-hidden
            className={`inline-block size-2 rounded-full ${STATUS_COLOR[status]}`}
          />
          {STATUS_LABEL[status]}
        </span>

        <span className="ml-auto flex gap-3">
          <button
            type="button"
            disabled
            title="Task 6 で実装"
            className="rounded border border-black/20 px-3 py-1.5 text-sm text-black/40 dark:border-white/25 dark:text-white/40"
          >
            ヒント
          </button>
          <button
            type="button"
            disabled
            title="Task 7 以降で実装"
            className="rounded border border-black/20 px-3 py-1.5 text-sm text-black/40 dark:border-white/25 dark:text-white/40"
          >
            授業を終了
          </button>
        </span>
      </div>

      {lessonSessionId === null ? (
        <p className="text-xs text-black/60 dark:text-white/60">
          授業セッションがありません。「今日の授業」から開始してください。
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {/* AI の音声はここから鳴る */}
      <audio ref={audioRef} autoPlay />
    </footer>
  );
}
