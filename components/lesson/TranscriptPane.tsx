/**
 * 中央ペイン: AI音声の状態・字幕・会話履歴（docs/BASIC_DESIGN_v03.md §3.2）。
 *
 * 音声の接続状態は下部の VoiceControls が表示する。
 * 書き起こしの保存と表示は Task 7。ここではまだ空のまま。
 */
export function TranscriptPane({ topicTitle }: { topicTitle: string }) {
  return (
    <section
      aria-label="会話履歴"
      className="flex flex-col gap-4 overflow-y-auto p-4"
    >
      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-black/15 p-8 text-center text-sm text-black/50 dark:border-white/20 dark:text-white/50">
        <p>
          「{topicTitle}」の授業。下の「開始」でマイクをつなぐ。
          <br />
          会話の書き起こしの表示は Task 7 で実装する。
        </p>
      </div>
    </section>
  );
}
