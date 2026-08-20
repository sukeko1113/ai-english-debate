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
  mark_phase_complete: "/api/results/phase",
};

/**
 * サーバーの応答のうち、モデルへ返してよいキー。
 *
 * **正誤・点数は絶対に含めない**（docs/REALTIME_ARCHITECTURE.md §4）。
 * next_phase は授業の進行位置であって採点結果ではないので返してよい。
 */
export const ALLOWED_TOOL_OUTPUT_KEYS = ["ok", "next_phase"] as const;

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
  {
    type: "function",
    name: "mark_phase_complete",
    description:
      "Call this when the current lesson phase is finished, that is, when the " +
      "student has answered every question of the current phase. " +
      "Pass the id of the phase you just finished. " +
      "The application decides what comes next and replies with next_phase. " +
      "Do not start the next phase before that reply arrives.",
    parameters: {
      type: "object",
      properties: {
        phase_id: {
          type: "string",
          description: "The id of the phase that has just been finished",
        },
      },
      required: ["phase_id"],
      additionalProperties: false,
    },
  },
] as const satisfies RealtimeToolsConfig;

/** 教材が持っているものに応じて、渡す tool を選ぶ */
export function toolsFor(options: {
  hasQuestions: boolean;
  hasPhases: boolean;
}): RealtimeToolsConfig | undefined {
  const names: string[] = [];
  if (options.hasQuestions) names.push("record_answer");
  if (options.hasPhases) names.push("mark_phase_complete");
  if (names.length === 0) return undefined;

  return LESSON_TOOLS.filter((tool) => names.includes(tool.name));
}
