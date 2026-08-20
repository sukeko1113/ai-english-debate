import { describe, expect, it, vi } from "vitest";

import { dispatchFunctionCall } from "@/lib/openai/function-calls";
import { LESSON_TOOLS, TOOL_ROUTES } from "@/lib/openai/tools";
import type { FunctionCallArgumentsDoneEvent } from "@/lib/openai/types";

/**
 * ブラウザ側の function call 処理（docs/REALTIME_ARCHITECTURE.md §4）。
 * DOM もネットワークも使わずに検証する。
 */

function callEvent(
  name: string,
  args: string,
): FunctionCallArgumentsDoneEvent {
  return {
    type: "response.function_call_arguments.done",
    call_id: "call_1",
    name,
    arguments: args,
  };
}

function sentPayloads(send: ReturnType<typeof vi.fn>): unknown[] {
  return send.mock.calls.map((call) => JSON.parse(String(call[0])));
}

/** tool が受け取る引数名だけを集める（説明文は見ない） */
function argumentNames(): string[] {
  return LESSON_TOOLS.flatMap((tool) => {
    const parameters = tool.parameters as {
      properties?: Record<string, unknown>;
    };
    return Object.keys(parameters.properties ?? {});
  });
}

describe("record_answer の tool 定義", () => {
  it("点数・正誤を引数に持たない", () => {
    // CLAUDE.md 禁止事項2。モデルに点数や正誤を決めさせない
    for (const name of argumentNames()) {
      expect(name).not.toMatch(/score|correct|grade|result|point/i);
    }
    expect(argumentNames()).toEqual([
      "item_id",
      "answer_text",
      "attempt_no",
      "side",
      "ja_text",
      "en_text",
      "phase_id",
    ]);
  });

  it("session_id を引数に持たない", () => {
    // サーバー側で認証セッションと紐づける。渡せば改ざん対象が増えるだけ
    expect(argumentNames()).not.toContain("session_id");
    expect(argumentNames()).not.toContain("student_id");
  });

  it("tool は記録用2つと進行用1つだけ", () => {
    expect(LESSON_TOOLS.map((tool) => tool.name)).toEqual([
      "record_answer",
      "record_argument",
      "mark_phase_complete",
    ]);
    expect(Object.keys(TOOL_ROUTES).sort()).toEqual([
      "mark_phase_complete",
      "record_answer",
      "record_argument",
    ]);
  });
});

describe("function call の中継", () => {
  it("サーバーへ渡し、モデルへは ok だけ返す", async () => {
    const send = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true })),
    );

    const result = await dispatchFunctionCall({
      event: callEvent(
        "record_answer",
        JSON.stringify({ item_id: "q1", answer_text: "hello", attempt_no: 1 }),
      ),
      lessonSessionId: "session-1",
      send,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true });

    const call = fetchImpl.mock.calls[0];
    expect(String(call?.[0])).toBe("/api/results/answer");
    const body = JSON.parse(String(call?.[1]?.body));
    // lessonSessionId はクライアントが持っている値。サーバーが所有者を検証する
    expect(body.lessonSessionId).toBe("session-1");
    expect(body.args.answer_text).toBe("hello");
    // session_id をモデルの引数として送らない
    expect(body.args.session_id).toBeUndefined();

    const payloads = sentPayloads(send) as {
      type: string;
      item?: { output?: string };
    }[];
    expect(payloads[0]?.type).toBe("conversation.item.create");
    // 正誤や点数を返さない。返すとモデルが口に出す
    expect(payloads[0]?.item?.output).toBe('{"ok":true}');
    expect(payloads[1]?.type).toBe("response.create");
  });

  it("サーバーが拒否したら ok:false。授業は止めない", async () => {
    const send = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("no", { status: 400 }),
    );

    const result = await dispatchFunctionCall({
      event: callEvent("record_answer", JSON.stringify({ item_id: "q1" })),
      lessonSessionId: "session-1",
      send,
      fetchImpl,
    });

    expect(result).toEqual({ ok: false });
    const payloads = sentPayloads(send) as { item?: { output?: string } }[];
    expect(payloads[0]?.item?.output).toBe('{"ok":false}');
    // 失敗の中身をモデルへ渡さない
    expect(payloads[0]?.item?.output).not.toContain("no");
  });

  it("通信に失敗しても例外を投げない", async () => {
    const send = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });

    await expect(
      dispatchFunctionCall({
        event: callEvent("record_answer", JSON.stringify({ item_id: "q1" })),
        lessonSessionId: "session-1",
        send,
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false });
  });

  it("知らない tool 名はサーバーへ送らない", async () => {
    const send = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));

    const result = await dispatchFunctionCall({
      event: callEvent("save_quiz_result", JSON.stringify({ score: 100 })),
      lessonSessionId: "session-1",
      send,
      fetchImpl,
    });

    expect(result).toEqual({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("壊れた引数はサーバーへ送らない", async () => {
    const send = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}"));

    await dispatchFunctionCall({
      event: callEvent("record_answer", "not json"),
      lessonSessionId: "session-1",
      send,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
