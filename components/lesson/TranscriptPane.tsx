/**
 * 中央ペイン: AI音声の状態・字幕・会話履歴（docs/BASIC_DESIGN_v03.md §3.2）。
 *
 * 音声は Task 4 で接続する。ここでは空の履歴と未接続の表示だけを出す。
 */
export function TranscriptPane({ topicTitle }: { topicTitle: string }) {
  return (
    <section
      aria-label="会話履歴"
      className="flex flex-col gap-4 overflow-y-auto p-4"
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          aria-hidden
          className="inline-block size-2 rounded-full bg-black/30 dark:bg-white/30"
        />
        <span className="text-black/60 dark:text-white/60">
          音声は未接続（Task 4 で実装）
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-black/15 p-8 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
        <p>
          「{topicTitle}」の授業を開始すると、
          <br />
          ここに AI 教師との会話が表示されます。
        </p>
      </div>
    </section>
  );
}
