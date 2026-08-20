"use client";

import { useEffect, useRef } from "react";

import { MaterialPane } from "@/components/lesson/MaterialPane";
import { StepPanel } from "@/components/lesson/StepPanel";
import type { LessonMaterial } from "@/lib/db/types";

import { VoiceControls } from "./VoiceControls";
import {
  useRealtimeSession,
  type TranscriptEntry,
} from "./useRealtimeSession";

/**
 * 授業画面の4領域をまとめて持つ（docs/BASIC_DESIGN_v03.md §3.2）。
 *
 * フェーズが進むと左（教材のハイライト）と右（現在ステップ）が同時に変わるので、
 * hook をここ1か所で呼び、4領域すべてをこの下に置く。
 */
export function VoiceSession({
  lessonSessionId,
  material,
  currentStep,
  initialPhaseId,
  initialTranscript,
}: {
  lessonSessionId: string | null;
  material: LessonMaterial;
  currentStep: number;
  /** アプリ側が持っている現在フェーズ */
  initialPhaseId: string | null;
  /** DB に保存済みの会話履歴。再読み込みしても消えないようにする */
  initialTranscript: TranscriptEntry[];
}) {
  const session = useRealtimeSession(
    lessonSessionId,
    initialTranscript,
    initialPhaseId,
  );
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);

  // 新しい発話が出たら最下部へ追従する。
  // ただし生徒が自分で上へスクロールして読み返しているときは邪魔しない
  const hasAnchored = useRef(false);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // 初回表示は必ず最下部から始める。
    // 途中で読み込み直しても、続きが見えている状態にするため
    if (!hasAnchored.current) {
      hasAnchored.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 120) return;

    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [session.transcript]);

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <MaterialPane
          material={material}
          currentPhaseId={session.currentPhaseId}
        />

        <section
          ref={scrollRef}
          aria-label="会話履歴"
          className="flex flex-col gap-3 overflow-y-auto p-4"
        >
          {session.transcript.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded border border-dashed border-black/15 p-8 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
              <p>
                「{material.topic.titleJa}」の授業。下の「開始」でマイクをつなぐ。
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
          {/* 追従用の目印。会話が増えるとここまでスクロールする */}
          <div ref={bottomRef} />
        </section>

        <StepPanel
          currentStep={currentStep}
          currentPhaseId={session.currentPhaseId}
          phases={material.phases}
          questions={material.questions}
        />
      </div>

      <VoiceControls session={session} hasSession={lessonSessionId !== null} />
    </>
  );
}
