"use client";

import type { ReactNode } from "react";

import { VoiceControls } from "./VoiceControls";
import {
  useRealtimeSession,
  type TranscriptEntry,
} from "./useRealtimeSession";

/**
 * 授業画面の4領域のうち、中央（会話履歴）と下部（音声操作）を持つ。
 *
 * 音声の状態と会話履歴を両方が使うので、hook をここ1か所で呼び、
 * 左（教材）と右（Step・回答欄）は props で受け取ってそのまま置く。
 * 左右は Server Component のままにできる。
 */
export function VoiceSession({
  lessonSessionId,
  topicTitle,
  initialTranscript,
  left,
  right,
}: {
  lessonSessionId: string | null;
  topicTitle: string;
  /** DB に保存済みの会話履歴。再読み込みしても消えないようにする */
  initialTranscript: TranscriptEntry[];
  left: ReactNode;
  right: ReactNode;
}) {
  const session = useRealtimeSession(lessonSessionId, initialTranscript);

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        {left}

        <section
          aria-label="会話履歴"
          className="flex flex-col gap-3 overflow-y-auto p-4"
        >
          {session.transcript.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-black/15 p-8 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
              <p>
                「{topicTitle}」の授業。下の「開始」でマイクをつなぐ。
                <br />
                話した内容がここに出ます。
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-3 text-sm">
              {session.transcript.map((line, index) => (
                <li
                  key={`${index}-${line.text.slice(0, 16)}`}
                  className={
                    line.speaker === "student" ? "text-right" : "text-left"
                  }
                >
                  <span className="block text-xs text-black/50 dark:text-white/50">
                    {line.speaker === "student" ? "あなた" : "AI教師"}
                  </span>
                  <span
                    className={`inline-block rounded px-3 py-2 ${
                      line.speaker === "student"
                        ? "bg-black/5 dark:bg-white/10"
                        : "bg-black/10 dark:bg-white/15"
                    }`}
                  >
                    {line.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {right}
      </div>

      <VoiceControls session={session} hasSession={lessonSessionId !== null} />
    </>
  );
}
