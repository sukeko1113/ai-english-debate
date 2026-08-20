import { ALLOWED_TOOL_OUTPUT_KEYS, TOOL_ROUTES } from "./tools";
import type { FunctionCallArgumentsDoneEvent } from "./types";

/**
 * ブラウザがデータチャネルで受けた function call を、サーバー API へ渡して
 * 結果をモデルへ返す（docs/REALTIME_ARCHITECTURE.md §4）。
 *
 * DOM に触らない純粋な処理にしてある。ブラウザを立ち上げずにテストするため。
 *
 * 守っていること:
 *   - **`function_call_output` に正誤や点数を含めない。**
 *     含めるとモデルがそれを口に出す
 *   - `session_id` はモデルから受け取らず、呼び出し側が持っている
 *     lessonSessionId を使う。サーバーは所有者を検証する
 *   - 知らない tool 名はサーバーへ送らない
 */

export interface DispatchParams {
  event: FunctionCallArgumentsDoneEvent;
  lessonSessionId: string;
  /** データチャネルへ送る */
  send: (payload: string) => void;
  fetchImpl?: typeof fetch;
}

/**
 * モデルへ返す結果。
 *
 * **正誤・点数を含めないこと。** 含めるとモデルがそれを口に出す。
 * 返してよいキーは ALLOWED_TOOL_OUTPUT_KEYS に列挙したものだけで、
 * サーバーの応答をそのまま素通しにしない。
 */
interface ToolOutput {
  ok: boolean;
  /** 授業の進行位置。採点結果ではない */
  next_phase?: string | null;
}

/** サーバーの応答から、モデルへ返してよいキーだけを取り出す */
function pickAllowed(payload: unknown, ok: boolean): ToolOutput {
  const output: ToolOutput = { ok };
  if (typeof payload !== "object" || payload === null) return output;

  const record = payload as Record<string, unknown>;
  for (const key of ALLOWED_TOOL_OUTPUT_KEYS) {
    if (key === "ok") continue;
    const value = record[key];
    if (typeof value === "string" || value === null) {
      output[key] = value;
    }
  }
  return output;
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sendOutput(
  send: (payload: string) => void,
  callId: string,
  output: ToolOutput,
): void {
  send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    }),
  );
  // 結果を返しただけでは発話が続かないので、応答生成を促す
  send(JSON.stringify({ type: "response.create" }));
}

export async function dispatchFunctionCall(
  params: DispatchParams,
): Promise<ToolOutput> {
  const { event, lessonSessionId, send } = params;
  const fetchImpl = params.fetchImpl ?? fetch;

  const route = TOOL_ROUTES[event.name];
  const args = parseArguments(event.arguments);

  if (!route || !args) {
    // 知らない tool 名や壊れた引数はサーバーへ送らない
    const output: ToolOutput = { ok: false };
    sendOutput(send, event.call_id, output);
    return output;
  }

  let output: ToolOutput = { ok: false };
  try {
    const response = await fetchImpl(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonSessionId, args }),
    });

    const payload: unknown = response.ok
      ? await response.json().catch(() => null)
      : null;
    // サーバーが ok:false を返すこともある（フェーズの食い違いなど）
    const serverOk =
      typeof payload === "object" &&
      payload !== null &&
      "ok" in payload &&
      typeof (payload as { ok: unknown }).ok === "boolean"
        ? (payload as { ok: boolean }).ok
        : response.ok;

    output = pickAllowed(payload, response.ok && serverOk);
  } catch {
    // 保存に失敗しても授業を止めない。モデルには ok:false だけ返す
    output = { ok: false };
  }

  sendOutput(send, event.call_id, output);
  return output;
}
