import type { RealtimeSessionCreateRequest } from "openai/resources/realtime/realtime";

/**
 * OpenAI との通信。**OPENAI_API_KEY を読んでよい唯一のファイル。**
 *
 * docs/SECURITY.md §1 / docs/API_SPEC.md「実装上の注意」。
 * 他のファイルからの参照は tests/guards/openai-key.test.ts が禁止している。
 *
 * 接続方式は unified interface（サーバーが SDP を中継する）。
 * ブラウザには OpenAI のクレデンシャルが一切渡らない
 * （docs/REALTIME_ARCHITECTURE.md §2）。
 *
 * 参照した仕様（2026-08-20 時点）:
 *   POST https://api.openai.com/v1/realtime/calls
 *   multipart/form-data の sdp（SDP offer）と session（設定 JSON）
 *   レスポンスは SDP answer。Location ヘッダに call id
 *   セッション設定の形は openai@7.5.0 の
 *   RealtimeSessionCreateRequest（type: 'realtime' 必須）で確認した
 */

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const RESPONSES_URL = "https://api.openai.com/v1/responses";

/** OpenAI 側の失敗。**本文をそのままクライアントへ返さないこと** */
export class OpenAIRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`OpenAI への要求が失敗した (${status})`);
    this.name = "OpenAIRequestError";
  }
}

/** 設定漏れ。起動時ではなく使用時に気づけるようにする */
export class OpenAIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIConfigError";
  }
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new OpenAIConfigError("OPENAI_API_KEY が設定されていない");
  }
  return key;
}

/**
 * Realtime のモデル名。**コードに直書きしない。**
 * mini 系との比較を実測できるようにするため（docs/REALTIME_ARCHITECTURE.md §8）。
 */
export function getRealtimeModel(): string {
  const model = process.env.OPENAI_REALTIME_MODEL;
  if (!model) {
    throw new OpenAIConfigError("OPENAI_REALTIME_MODEL が設定されていない");
  }
  return model;
}

/**
 * 採点器のモデル。**学期の途中で勝手に変わらないようピン留めする**
 * （docs/RUBRIC.md「モデル採点」）。会話用とは別のモデルを選べる。
 */
export function getScorerModel(): string {
  const model = process.env.SCORER_MODEL;
  if (!model) {
    throw new OpenAIConfigError("SCORER_MODEL が設定されていない");
  }
  return model;
}

export function getScorerPromptVersion(): string {
  return process.env.SCORER_PROMPT_VERSION ?? "v1";
}

/**
 * 採点器を呼ぶ。**JSON だけを返させる**（docs/RUBRIC.md）。
 *
 * 会話用の Realtime とは別経路。遅くてよいので、安定した安いモデルを選べる。
 * fetchImpl を差し替えられるようにしてあるのは、ネットワークへ出ずに
 * テストするため。
 */
export async function createScoringCompletion(
  params: { instructions: string; input: string; model: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetchImpl(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      instructions: params.instructions,
      input: params.input,
      // 散文を返させない
      text: { format: { type: "json_object" } },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OpenAIRequestError(response.status, detail);
  }

  const payload: unknown = await response.json();
  const text = extractOutputText(payload);
  if (text === null) {
    throw new OpenAIRequestError(200, "採点器の応答を読めなかった");
  }
  return text;
}

/** Responses API の出力からテキストを取り出す */
function extractOutputText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  if (typeof record.output_text === "string") return record.output_text;

  const output = record.output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

export interface RealtimeCallParams {
  /** ブラウザが作った SDP offer */
  sdp: string;
  session: RealtimeSessionCreateRequest;
  /** 生 ID ではなくハッシュ（lib/openai/safety-id.ts） */
  safetyId: string;
}

export interface RealtimeCallResult {
  /** そのままブラウザへ返す SDP answer */
  sdpAnswer: string;
  /** Location ヘッダ由来の call id。利用量の突き合わせに使う */
  callId: string | null;
}

/**
 * SDP を OpenAI へ中継して SDP answer を得る。
 *
 * fetchImpl を差し替えられるようにしてあるのは、ネットワークへ出ずに
 * テストできるようにするため（このセッションには API キーが無い）。
 */
export async function createRealtimeCall(
  params: RealtimeCallParams,
  fetchImpl: typeof fetch = fetch,
): Promise<RealtimeCallResult> {
  const apiKey = getApiKey();

  const form = new FormData();
  form.append("sdp", params.sdp);
  form.append("session", JSON.stringify(params.session));

  const response = await fetchImpl(REALTIME_CALLS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // 生の学籍番号・氏名は送らない（docs/SECURITY.md §4）
      "OpenAI-Safety-Identifier": params.safetyId,
    },
    body: form,
  });

  if (!response.ok) {
    // 本文はサーバーログ用。呼び出し側は 502 と汎用メッセージを返すこと
    const detail = await response.text().catch(() => "");
    throw new OpenAIRequestError(response.status, detail);
  }

  return {
    sdpAnswer: await response.text(),
    callId: callIdFromLocation(response.headers.get("location")),
  };
}

/** Location: /v1/realtime/calls/rtc_xxx → rtc_xxx */
function callIdFromLocation(location: string | null): string | null {
  if (!location) return null;
  const last = location.split("/").filter(Boolean).pop();
  return last ?? null;
}
