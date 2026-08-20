"use client";

/**
 * 下部: マイク・停止・ヒント・終了（docs/BASIC_DESIGN_v03.md §3.2）。
 *
 * 音声接続は Task 4、ヒント記録は Task 6。今はすべて無効にしておく。
 * 押せてしまうと「動いていない」のか「壊れている」のか分からなくなるため。
 */
const CONTROLS = [
  { label: "マイク開始", note: "Task 4" },
  { label: "停止", note: "Task 4" },
  { label: "ヒント", note: "Task 6" },
  { label: "授業を終了", note: "Task 7 以降" },
];

export function LessonControls() {
  return (
    <footer className="flex flex-wrap items-center gap-3 border-t border-black/10 p-3 dark:border-white/15">
      {CONTROLS.map((control) => (
        <button
          key={control.label}
          type="button"
          disabled
          title={`${control.note} で実装`}
          className="rounded border border-black/20 px-3 py-1.5 text-sm text-black/40 dark:border-white/25 dark:text-white/40"
        >
          {control.label}
        </button>
      ))}
      <span className="text-xs text-black/50 dark:text-white/50">
        音声はまだ接続していない
      </span>
    </footer>
  );
}
