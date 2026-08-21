"use client";

import { useCallback, useEffect, useRef } from "react";

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
  const scrollRef = useRef<HTMLElement | null>(null);
  /**
   * 最新に追従するか。**位置を測って判断しない。**
   *
   * 以前は更新のたびに「下から何px離れているか」を測っていたが、
   * 滑らかスクロールの最中は位置がまだ追いついていないため、
   * 発話が続くと「離れている」と誤判定して追従をやめてしまっていた。
   * 一度やめると戻らない。生徒の操作だけでこの値を変える。
   */
  const followRef = useRef(true);

  /** 生徒が自分でスクロールしたときだけ、追従するかどうかを切り替える */
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    followRef.current = distanceFromBottom <= 80;
  }, []);

  const pinToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !followRef.current) return;
    // 瞬間移動させる。アニメーションだと次の発話に追い越される
    container.scrollTop = container.scrollHeight;
  }, []);

  // 発話が増えたら最下部へ
  useEffect(() => {
    pinToBottom();
  }, [session.transcript, pinToBottom]);

  // 長い発話の折り返しや画像の読み込みで、あとから高さが変わることがある。
  // 高さの変化そのものを見て、追従中なら下へ寄せ直す
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => pinToBottom());
    observer.observe(container);
    for (const child of Array.from(container.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [session.transcript, pinToBottom]);

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <MaterialPane
          material={material}
          currentPhaseId={session.currentPhaseId}
        />

        <section
          ref={scrollRef}
          onScroll={handleScroll}
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
        </section>

        <StepPanel
          lessonSessionId={lessonSessionId}
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
