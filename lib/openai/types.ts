/**
 * Realtime のイベント型。
 *
 * CLAUDE.md「Realtime のイベント型は lib/openai/types.ts に定義する」。
 * `any` を使わない。ブラウザのデータチャネルで受け取るイベントは
 * **信用できない入力**として扱う（docs/REALTIME_ARCHITECTURE.md §1）ので、
 * 受け取り側で型を絞ってから使う。
 */

/** データチャネルの名前。OpenAI 側の慣例に合わせる */
export const REALTIME_DATA_CHANNEL = "oai-events";

export interface RealtimeServerEventBase {
  type: string;
  event_id?: string;
}

/** モデルが function tool を呼び終えたとき（Task 6 で使う） */
export interface FunctionCallArgumentsDoneEvent extends RealtimeServerEventBase {
  type: "response.function_call_arguments.done";
  call_id: string;
  name: string;
  /** JSON 文字列。**中身を検証せずに保存しないこと** */
  arguments: string;
}

/** 生徒の発話の書き起こし（Task 7 で保存する） */
export interface InputAudioTranscriptionCompletedEvent
  extends RealtimeServerEventBase {
  type: "conversation.item.input_audio_transcription.completed";
  item_id: string;
  transcript: string;
}

/** AI の発話の書き起こし */
export interface OutputAudioTranscriptDoneEvent extends RealtimeServerEventBase {
  type: "response.output_audio_transcript.done";
  item_id: string;
  transcript: string;
}

export interface RealtimeErrorEvent extends RealtimeServerEventBase {
  type: "error";
  error: { type?: string; code?: string; message?: string };
}

export type KnownRealtimeServerEvent =
  | FunctionCallArgumentsDoneEvent
  | InputAudioTranscriptionCompletedEvent
  | OutputAudioTranscriptDoneEvent
  | RealtimeErrorEvent;

/** function call のイベントかどうか。形が合わなければ false */
export function isFunctionCallDone(
  event: RealtimeServerEventBase,
): event is FunctionCallArgumentsDoneEvent {
  if (event.type !== "response.function_call_arguments.done") return false;
  const candidate = event as Partial<FunctionCallArgumentsDoneEvent>;
  return (
    typeof candidate.call_id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.arguments === "string"
  );
}

/**
 * データチャネルの文字列をイベントとして読む。
 * 形が合わなければ null。**壊れた入力で落ちないこと。**
 */
export function parseRealtimeEvent(
  raw: string,
): RealtimeServerEventBase | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== "string"
  ) {
    return null;
  }
  return parsed as RealtimeServerEventBase;
}
