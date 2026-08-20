import type { RealtimeToolsConfig } from "openai/resources/realtime/realtime";

/**
 * セッション中にモデルが呼べる function tool。
 *
 * **記録専用。点数を引数に持つ tool を追加しないこと**
 * （CLAUDE.md 禁止事項2 / docs/REALTIME_ARCHITECTURE.md §4）。
 *
 * WebRTC 構成では tool 呼び出しがブラウザのデータチャネルを通るため、
 * 引数はすべて改ざん可能な値として扱う。採点はセッション終了後に
 * サーバー側で書き起こしと答案から行う。
 *
 * **`session_id` を引数に含めない。** サーバー側で認証セッションと紐づける。
 * モデルに渡す必要が無く、渡せば改ざん対象が増えるだけ。
 */

/** ブラウザから受けた tool 名を API ルートへ対応づける */
export const TOOL_ROUTES: Readonly<Record<string, string>> = {
  record_answer: "/api/results/answer",
};

export const LESSON_TOOLS = [
  {
    type: "function",
    name: "record_answer",
    description:
      "Record the student answer to a dictation or writing item. " +
      "Record verbatim what the student said. Do not correct it. Do not score it.",
    parameters: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "The question id from the material",
        },
        answer_text: {
          type: "string",
          description: "Verbatim student answer",
        },
        attempt_no: {
          type: "integer",
          description: "1 for first attempt",
        },
      },
      required: ["item_id", "answer_text", "attempt_no"],
      additionalProperties: false,
    },
  },
] as const satisfies RealtimeToolsConfig;
