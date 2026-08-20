import { describe, expect, it } from "vitest";

import { toTranscriptLine } from "@/lib/openai/transcript-events";
import { parseRealtimeEvent } from "@/lib/openai/types";

/**
 * Realtime の書き起こしイベントの読み取り（docs/REALTIME_ARCHITECTURE.md §6）。
 */

function event(raw: object) {
  const parsed = parseRealtimeEvent(JSON.stringify(raw));
  if (!parsed) throw new Error("イベントとして読めなかった");
  return parsed;
}

describe("書き起こしイベント", () => {
  it("生徒の発話を読む", () => {
    expect(
      toTranscriptLine(
        event({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "item_1",
          transcript: "  反対です  ",
        }),
      ),
    ).toEqual({ speaker: "student", text: "反対です" });
  });

  it("AI の発話を読む", () => {
    expect(
      toTranscriptLine(
        event({
          type: "response.output_audio_transcript.done",
          item_id: "item_2",
          transcript: "そうです。今日は反対立論です。",
        }),
      ),
    ).toEqual({ speaker: "tutor", text: "そうです。今日は反対立論です。" });
  });

  it("関係ないイベントは無視する", () => {
    expect(
      toTranscriptLine(event({ type: "response.created" })),
    ).toBeNull();
  });

  it("壊れたイベントで落ちない", () => {
    expect(
      toTranscriptLine(
        event({
          type: "conversation.item.input_audio_transcription.completed",
          transcript: 123,
        }),
      ),
    ).toBeNull();

    expect(
      toTranscriptLine(
        event({
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "   ",
        }),
      ),
    ).toBeNull();

    // JSON として壊れているものは parse の段階で弾かれる
    expect(parseRealtimeEvent("not json")).toBeNull();
    expect(parseRealtimeEvent('{"no":"type"}')).toBeNull();
  });
});
