import { notFound } from "next/navigation";

import { MaterialPane } from "@/components/lesson/MaterialPane";
import { StepPanel } from "@/components/lesson/StepPanel";
import { TranscriptPane } from "@/components/lesson/TranscriptPane";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { requireStudent } from "@/lib/auth/student";
import { getLessonMaterial } from "@/lib/db/materials";
import { findUnfinishedSession } from "@/lib/db/sessions";

/**
 * 授業画面。docs/BASIC_DESIGN_v03.md §3.2 の4領域。
 *
 *   左   本文・語彙・文法      教材を見ながら会話する
 *   中央 AI音声状態・会話履歴  音声授業の中心（Task 4 で接続）
 *   右   現在Step・回答欄      何をしているか迷わせない
 *   下   マイク・停止・ヒント・終了
 *
 * 進行状態は lesson_sessions が正（docs/REALTIME_ARCHITECTURE.md §5）。
 * セッションが無ければ step 1 として表示する。
 */
export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const { materialId } = await params;
  const student = await requireStudent();

  const material = await getLessonMaterial(materialId).catch(() => null);
  if (!material) notFound();

  const session = await findUnfinishedSession(student.id, materialId);
  const currentStep = session?.currentStep ?? 1;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-baseline gap-x-3 border-b border-black/10 px-4 py-3 dark:border-white/15">
        <h1 className="text-lg font-bold">{material.topic.titleJa}</h1>
        <span className="text-sm text-black/60 dark:text-white/60">
          {material.topic.titleEn} / {material.level}
        </span>
        <span className="ml-auto text-sm text-black/60 dark:text-white/60">
          {session ? `セッション: ${session.status}` : "セッション未開始"}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <MaterialPane material={material} />
        <TranscriptPane topicTitle={material.topic.titleJa} />
        <StepPanel
          currentStep={currentStep}
          currentPhaseId={session?.currentPhase ?? null}
          phases={material.phases}
          questions={material.questions}
        />
      </div>

      <VoiceControls lessonSessionId={session?.id ?? null} />
    </div>
  );
}
