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
