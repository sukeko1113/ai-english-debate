import type { LessonMaterial } from "@/lib/db/types";

/**
 * 左ペイン: 本文・語彙・文法ポイント（docs/BASIC_DESIGN_v03.md §3.2）。
 * 教材を見ながら会話するための領域。
 */
export function MaterialPane({ material }: { material: LessonMaterial }) {
  return (
    <section
      aria-label="教材"
      className="flex flex-col gap-6 overflow-y-auto border-r border-black/10 p-4 dark:border-white/15"
    >
      <div>
        <h2 className="text-sm font-bold text-black/60 dark:text-white/60">
          本文
        </h2>
        <p className="mt-2 leading-7">{material.script}</p>
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
