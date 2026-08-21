"use client";

import { useState } from "react";

import { STEP_LABELS } from "./steps";
import type { PublicPhase, PublicQuestion } from "@/lib/db/types";

/**
 * 右ペイン: 現在 Step・課題・回答欄（docs/BASIC_DESIGN_v03.md §3.2）。
 * 「何をしているか迷わせない」ための領域。
 *
 * 入力はローカル state に置くだけで、**まだサーバーへ送らない。**
 * 答案の記録は record_answer と /api/results/answer で行う（Task 6）。
 */
export function StepPanel({
  lessonSessionId,
  currentStep,
  currentPhaseId,
  phases,
  questions,
}: {
  lessonSessionId: string | null;
  currentStep: number;
  /** v03 プロンプトの状態名。アプリ側が持っている値 */
  currentPhaseId: string | null;
  phases: PublicPhase[];
  questions: PublicQuestion[];
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** 記録済みの回数。同じ問題を2回書いたら attempt_no を増やす */
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  const phase = phases.find((candidate) => candidate.id === currentPhaseId);
  // このフェーズで書く課題だけに絞る。
  // 全問を出すと、ディクテーション中に英作文の課題まで見えてしまう
  const activeQuestions = phase
    ? questions.filter((question) => phase.itemKeys.includes(question.key))
    : [];

  async function record(question: PublicQuestion): Promise<void> {
    const text = (answers[question.id] ?? "").trim();
    if (!lessonSessionId || text.length === 0) return;

    const attemptNo = (attempts[question.id] ?? 0) + 1;
    setSaving(question.id);
    try {
      const response = await fetch("/api/results/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonSessionId,
          args: {
            item_id: question.id,
            answer_text: text,
            attempt_no: attemptNo,
          },
        }),
      });
      // サーバーは { ok: true } しか返さない。正誤も点数もここには来ない
      if (response.ok) {
        setAttempts((previous) => ({ ...previous, [question.id]: attemptNo }));
        setSaved((previous) => ({
          ...previous,
          [question.id]: `記録しました（${attemptNo}回目）`,
        }));
      } else {
        setSaved((previous) => ({
          ...previous,
          [question.id]: "記録できませんでした",
        }));
      }
    } catch {
      setSaved((previous) => ({
        ...previous,
        [question.id]: "記録できませんでした",
      }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      aria-label="現在のステップと回答"
      className="flex flex-col gap-4 overflow-y-auto border-l border-black/10 p-4 dark:border-white/15"
    >
      <div>
        <h2 className="text-sm font-bold text-black/60 dark:text-white/60">
          今日の進み方
        </h2>

        {phases.length > 0 ? (
          // v03 プロンプトのフェーズを持つ教材。現在位置はアプリ側が保持している
          <ol className="mt-2 flex flex-col gap-1 text-sm">
            {phases.map((phase) => {
              const current =
                phase.id === (currentPhaseId ?? phases[0]?.id ?? null);
              return (
                <li
                  key={phase.id}
                  aria-current={current ? "step" : undefined}
                  className={
                    current ? "font-bold" : "text-black/50 dark:text-white/50"
                  }
                >
                  {phase.labelJa}
                  <span className="ml-2 text-xs font-normal">
                    {phase.section}
                  </span>
                  {current ? (
                    <span className="ml-2 text-xs">［現在］</span>
                  ) : null}
                </li>
              );
            })}
            <li className="mt-1 text-xs text-black/50 dark:text-white/50">
              この先（Signpost 以降）は未実装
            </li>
          </ol>
        ) : (
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {STEP_LABELS.map((step) => {
            const state =
              step.no === currentStep
                ? "現在"
                : step.no < currentStep
                  ? "完了"
                  : "";
            return (
              <li
                key={step.no}
                aria-current={step.no === currentStep ? "step" : undefined}
                className={
                  step.no === currentStep
                    ? "font-bold"
                    : "text-black/50 dark:text-white/50"
                }
              >
                {step.no}. {step.nameJa}
                {state ? (
                  <span className="ml-2 text-xs">［{state}］</span>
                ) : null}
              </li>
            );
          })}
        </ol>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold text-black/60 dark:text-white/60">
          回答欄
        </h2>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          ディクテーションと英作文はここに書く。記録するとサーバーへ保存される。
        </p>

        {activeQuestions.length === 0 ? (
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            この段階は音声で進めます。書く課題はありません。
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-4">
            {activeQuestions.map((question) => (
              <div key={question.id} className="flex flex-col gap-1 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="font-semibold">
                    {question.key}
                    <span className="ml-2 text-xs font-normal text-black/50 dark:text-white/50">
                      {question.type}
                    </span>
                  </span>
                  <span className="text-black/70 dark:text-white/70">
                    {question.prompt}
                  </span>
                  <textarea
                    rows={question.type === "dictation" ? 2 : 3}
                    value={answers[question.id] ?? ""}
                    onChange={(event) =>
                      setAnswers((previous) => ({
                        ...previous,
                        [question.id]: event.target.value,
                      }))
                    }
                    className="rounded border border-black/20 px-2 py-1 dark:border-white/25"
                  />
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void record(question)}
                    disabled={
                      !lessonSessionId ||
                      saving === question.id ||
                      (answers[question.id] ?? "").trim().length === 0
                    }
                    className="rounded border border-black/20 px-2 py-1 text-xs disabled:opacity-40 dark:border-white/25"
                  >
                    {saving === question.id ? "記録中..." : "記録する"}
                  </button>
                  {saved[question.id] ? (
                    <span className="text-xs text-black/60 dark:text-white/60">
                      {saved[question.id]}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
            <p className="text-xs text-black/50 dark:text-white/50">
              採点は授業のあとでまとめて行います。ここでは正誤は出ません。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
