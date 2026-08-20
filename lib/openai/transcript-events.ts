import type { RealtimeServerEventBase } from "./types";

/**
 * Realtime の書き起こしイベントを、保存する形へ写す。
 *
 * Realtime は入力（生徒）と出力（AI）の両方で transcript イベントを出す
 * （docs/REALTIME_ARCHITECTURE.md §6）。イベント名は openai@7.5.0 の
 * RealtimeServerEvent で確認した。
 *
 * DOM に触らない純粋な処理にしてある。ブラウザ無しでテストするため。
 */

export interface TranscriptLine {
  speaker: "student" | "tutor";
  text: string;
}

/** 生徒の発話の書き起こしが確定したとき */
const STUDENT_EVENT =
  "conversation.item.input_audio_transcription.completed";

/** AI の発話の書き起こしが確定したとき */
const TUTOR_EVENTS = [
  "response.output_audio_transcript.done",
  // ベータ期の名前。モデルによってはこちらが来る
  "response.audio_transcript.done",
];

/**
 * 書き起こしイベントなら1行を返す。そうでなければ null。
 * **壊れた入力で落ちないこと。**
 */
export function toTranscriptLine(
  event: RealtimeServerEventBase,
): TranscriptLine | null {
  const speaker =
    event.type === STUDENT_EVENT
      ? "student"
      : TUTOR_EVENTS.includes(event.type)
        ? "tutor"
        : null;
  if (!speaker) return null;

  const transcript = (event as { transcript?: unknown }).transcript;
  if (typeof transcript !== "string") return null;

  const text = transcript.trim();
  if (text.length === 0) return null;

  return { speaker, text };
}
