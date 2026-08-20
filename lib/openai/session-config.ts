import type { RealtimeSessionCreateRequest } from "openai/resources/realtime/realtime";

/**
 * Realtime セッション設定の組み立て。
 *
 * 型は公式 SDK（openai パッケージ）の RealtimeSessionCreateRequest をそのまま使う。
 * SDK は **型の根拠としてのみ**使い、実行時は lib/openai/client.ts が fetch で
 * 直接 SDP を中継する。フィールド名を推測で書かないため。
 */

/**
 * turn detection の設定。
 *
 * 日本語話者の英語発話は言い直し・長い沈黙・小さい声が多く、既定値では
 * 途中で割り込まれる（docs/REALTIME_ARCHITECTURE.md §9）。
 * **実機テストで調整する前提。調整するときはここだけを直す。**
 *
 * eagerness: 'low' は「生徒が黙っても待つ」側に倒した設定。
 *
 * TODO(要確認): 環境変数で切り替えられるようにするか。今は .env.example に
 * 変数を増やさない方針にしているため、この定数を直す運用にしている。
 */
export const TURN_DETECTION = {
  type: "semantic_vad",
  eagerness: "low",
  create_response: true,
  interrupt_response: true,
} as const satisfies NonNullable<
  NonNullable<
    NonNullable<RealtimeSessionCreateRequest["audio"]>["input"]
  >["turn_detection"]
>;

/**
 * Task 4 の固定 instructions。
 *
 * Task 5 で lib/openai/instructions.ts の buildInstructions(material, session) に
 * 差し替える。**教材の中身をここへ書かないこと**（CLAUDE.md「教材をコードに埋め込まない」）。
 */
export const PLACEHOLDER_INSTRUCTIONS =
  "You are a friendly English teacher. Greet the student and ask their name.";

export interface BuildSessionParams {
  model: string;
  instructions?: string;
}

/** WebRTC の SDP と一緒に送るセッション設定を作る */
export function buildRealtimeSession(
  params: BuildSessionParams,
): RealtimeSessionCreateRequest {
  return {
    type: "realtime",
    model: params.model,
    instructions: params.instructions ?? PLACEHOLDER_INSTRUCTIONS,
    output_modalities: ["audio"],
    audio: {
      input: {
        // 採点はセッション終了後に書き起こしから行うので、書き起こしは必ず取る
        // （docs/REALTIME_ARCHITECTURE.md §6）。保存は Task 7。
        // language を固定しない。v03 の授業は説明も回答も日本語で、
        // 英文だけが英語になる。"en" に固定すると日本語の回答が壊れる
        transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: TURN_DETECTION,
      },
    },
    // 点数を扱う tool は作らない（CLAUDE.md 禁止事項2）。
    // 記録専用の tool は Task 6 で lib/openai/tools.ts に追加する
  };
}
