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
  currentStep,
  currentPhaseId,
  phases,
  questions,
}: {
  currentStep: number;
  /** v03 プロンプトの状態名。アプリ側が持っている値 */
  currentPhaseId: string | null;
  phases: PublicPhase[];
  questions: PublicQuestion[];
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

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
          ディクテーションと英作文はここに書く。保存は Task 6 で実装。
        </p>
        {questions.length === 0 ? (
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            この授業は音声で進めます。書く課題（ディクテーション・英作文）は未実装。
          </p>
        ) : null}

        <div className="mt-2 flex flex-col gap-3">
          {questions.map((question) => (
            <label key={question.id} className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">
                {question.key}
                <span className="ml-2 text-xs font-normal text-black/50 dark:text-white/50">
                  {question.type}
                </span>
              </span>
              <span className="text-black/70 dark:text-white/70">
                {question.prompt}
              </span>
              <input
                type="text"
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
          ))}
        </div>
      </div>
    </section>
  );
}
