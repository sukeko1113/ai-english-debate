"use client";

import { useState } from "react";

import type { LessonMaterial } from "@/lib/db/types";

/**
 * ディクテーション中は本文を隠す（AI教師プロンプト v03 §7）。
 * 対象文がそのまま画面に出ていると聞き取りにならない。
 */
const HIDE_SCRIPT_PHASES = new Set(["S90_DICTATION"]);

/**
 * 左ペイン: 本文・語彙・文法ポイント（docs/BASIC_DESIGN_v03.md §3.2）。
 *
 * いま扱っている文（FOCUS_SENTENCE）をハイライトする。
 * 音声だけだと本文のどこを読んでいるか分からない、という指摘への対応
 * （AI教師プロンプト v03 §5 の FOCUS_SENTENCE）。
 */
export function MaterialPane({
  material,
  currentPhaseId,
}: {
  material: LessonMaterial;
  currentPhaseId: string | null;
}) {
  const phase =
    material.phases.find((candidate) => candidate.id === currentPhaseId) ??
    material.phases[0];
  const focus = phase?.focusSentence?.trim() ?? "";
  const shouldHide = phase ? HIDE_SCRIPT_PHASES.has(phase.id) : false;

  // フェーズが変わったら伏せ直す。前の段階で開いたままにしない。
  // effect ではなく描画中に調整する（React の「props が変わったときの state 調整」）
  const [reveal, setReveal] = useState({ phaseId: phase?.id, shown: false });
  if (reveal.phaseId !== phase?.id) {
    setReveal({ phaseId: phase?.id, shown: false });
  }
  const revealed = reveal.shown;

  return (
    <section
      aria-label="教材"
      className="flex flex-col gap-6 overflow-y-auto border-r border-black/10 p-4 dark:border-white/15"
    >
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-black/60 dark:text-white/60">
            本文
          </h2>
          {phase ? (
            <span className="text-xs text-black/50 dark:text-white/50">
              {phase.section}
            </span>
          ) : null}
        </div>
        {shouldHide && !revealed ? (
          <div className="mt-2 rounded border border-dashed border-black/20 p-4 text-sm dark:border-white/25">
            <p className="text-black/60 dark:text-white/60">
              ディクテーション中は本文を隠しています。
              <br />
              聞こえたとおりに、右の回答欄へ書いてください。
            </p>
            <button
              type="button"
              onClick={() => setReveal({ phaseId: phase?.id, shown: true })}
              className="mt-3 rounded border border-black/20 px-2 py-1 text-xs dark:border-white/25"
            >
              本文を表示する
            </button>
          </div>
        ) : (
          <p className="mt-2 leading-7">
            <ScriptWithFocus script={material.script} focus={focus} />
          </p>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold text-black/60 dark:text-white/60">
          重要語彙
        </h2>
        <dl className="mt-2 flex flex-col gap-2">
          {material.vocabulary.map((item) => (
            <div key={item.word} className="text-sm">
              <dt className="font-semibold">{item.word}</dt>
              <dd className="text-black/70 dark:text-white/70">
                {item.meaning}
                {item.example ? (
                  <span className="block italic">{item.example}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h2 className="text-sm font-bold text-black/60 dark:text-white/60">
          文法ポイント
        </h2>
        <dl className="mt-2 flex flex-col gap-3">
          {material.grammarPoints.map((point) => (
            <div key={point.point} className="text-sm">
              <dt className="font-semibold">{point.point}</dt>
              <dd className="text-black/70 dark:text-white/70">
                {point.explanation}
                <ul className="mt-1 list-disc pl-5 italic">
                  {point.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * 本文のうち、いま扱っている文だけ色を変える。
 * 見つからなければ本文をそのまま出す（教材を書き換えたときも壊れない）。
 */
function ScriptWithFocus({
  script,
  focus,
}: {
  script: string;
  focus: string;
}) {
  const at = focus.length > 0 ? script.indexOf(focus) : -1;
  if (at < 0) return <>{script}</>;

  return (
    <>
      {script.slice(0, at)}
      <mark
        // 読んでいる場所。スクロールで見失わないよう自動で見える位置へ動かす
        ref={(node) =>
          node?.scrollIntoView({ block: "nearest", behavior: "smooth" })
        }
        className="rounded bg-yellow-200 px-0.5 font-medium text-black dark:bg-yellow-300/80"
      >
        {focus}
      </mark>
      {script.slice(at + focus.length)}
    </>
  );
}
