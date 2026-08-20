import { describe, expect, it } from "vitest";

import { estimateCostUsd, type ModelRate } from "@/lib/openai/pricing";
import { toUsageDelta } from "@/lib/openai/usage-events";
import { parseRealtimeEvent } from "@/lib/openai/types";

/**
 * 利用量の取り出しと概算費用（docs/REALTIME_ARCHITECTURE.md §8）。
 */

function event(raw: object) {
  const parsed = parseRealtimeEvent(JSON.stringify(raw));
  if (!parsed) throw new Error("イベントとして読めなかった");
  return parsed;
}

const responseDone = (usage: unknown) =>
  event({ type: "response.done", event_id: "e1", response: { usage } });

describe("利用量イベント", () => {
  it("音声とテキストのトークン数を取り出す", () => {
    expect(
      toUsageDelta(
        responseDone({
          input_token_details: { audio_tokens: 1200, text_tokens: 80 },
          output_token_details: { audio_tokens: 3400, text_tokens: 40 },
        }),
      ),
    ).toEqual({
      audioInputTokens: 1200,
      audioOutputTokens: 3400,
      textInputTokens: 80,
      textOutputTokens: 40,
    });
  });

  it("欠けている項目は 0 として扱う", () => {
    expect(
      toUsageDelta(responseDone({ input_token_details: { audio_tokens: 5 } })),
    ).toEqual({
      audioInputTokens: 5,
      audioOutputTokens: 0,
      textInputTokens: 0,
      textOutputTokens: 0,
    });
  });

  it("usage が無いイベントは無視する", () => {
    expect(toUsageDelta(event({ type: "response.created" }))).toBeNull();
    expect(toUsageDelta(responseDone(undefined))).toBeNull();
    // 全部 0 なら記録しない
    expect(toUsageDelta(responseDone({}))).toBeNull();
  });

  it("壊れた値で落ちない", () => {
    expect(
      toUsageDelta(
        responseDone({
          input_token_details: { audio_tokens: "たくさん" },
          output_token_details: null,
        }),
      ),
    ).toBeNull();

    expect(
      toUsageDelta(
        responseDone({ input_token_details: { audio_tokens: -100 } }),
      ),
    ).toBeNull();
  });
});

describe("概算費用", () => {
  const rates: Record<string, ModelRate> = {
    "test-model": {
      audioInputPerMillion: 32,
      audioOutputPerMillion: 64,
      textInputPerMillion: 4,
      textOutputPerMillion: 16,
      checkedOn: "2026-08-20",
    },
  };

  it("100万トークンあたりの単価から計算する", () => {
    const usd = estimateCostUsd(
      "test-model",
      {
        audioInputTokens: 1_000_000,
        audioOutputTokens: 500_000,
        textInputTokens: 0,
        textOutputTokens: 0,
      },
      rates,
    );

    // 32 + 32 = 64
    expect(usd).toBe(64);
  });

  it("numeric(10,4) に収まるよう丸める", () => {
    const usd = estimateCostUsd(
      "test-model",
      {
        audioInputTokens: 1,
        audioOutputTokens: 0,
        textInputTokens: 0,
        textOutputTokens: 0,
      },
      rates,
    );

    expect(usd).toBe(0);
  });

  it("単価が分からないモデルは null。0 で埋めない", () => {
    // 「0円だった」と「まだ分からない」は別物
    expect(
      estimateCostUsd(
        "unknown-model",
        {
          audioInputTokens: 999_999,
          audioOutputTokens: 0,
          textInputTokens: 0,
          textOutputTokens: 0,
        },
        rates,
      ),
    ).toBeNull();
  });

  it("既定の単価表は空。推測の値を入れない", () => {
    expect(
      estimateCostUsd("gpt-realtime-2.1", {
        audioInputTokens: 1000,
        audioOutputTokens: 1000,
        textInputTokens: 0,
        textOutputTokens: 0,
      }),
    ).toBeNull();
  });
});
