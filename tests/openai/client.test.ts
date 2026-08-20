import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRealtimeCall,
  getRealtimeModel,
  OpenAIConfigError,
  OpenAIRequestError,
} from "@/lib/openai/client";
import { buildRealtimeSession } from "@/lib/openai/session-config";

/**
 * OpenAI への中継部分。**ネットワークへ出さない。**
 * fetch を差し替えて、送っている中身を検証する。
 *
 * 実接続の確認はローカルで行う（このセッションに OPENAI_API_KEY は無い）。
 */

const env = { ...process.env };

function stubFetch(
  response: Response,
  captured: { request?: { url: string; init: RequestInit } },
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.request = { url: String(url), init: init ?? {} };
    return response;
  }) as typeof fetch;
}

describe("Realtime の SDP 中継", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.OPENAI_REALTIME_MODEL = "test-realtime-model";
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("モデル名は環境変数から読む（コードに直書きしない）", () => {
    expect(getRealtimeModel()).toBe("test-realtime-model");

    delete process.env.OPENAI_REALTIME_MODEL;
    expect(() => getRealtimeModel()).toThrow(OpenAIConfigError);
  });

  it("multipart の sdp と session を送り、SDP answer を返す", async () => {
    const captured: { request?: { url: string; init: RequestInit } } = {};
    const result = await createRealtimeCall(
      {
        sdp: "v=0\r\no=- offer",
        session: buildRealtimeSession({ model: getRealtimeModel() }),
        safetyId: "hashed-id",
      },
      stubFetch(
        new Response("v=0\r\no=- answer", {
          headers: { location: "/v1/realtime/calls/rtc_abc123" },
        }),
        captured,
      ),
    );

    expect(result.sdpAnswer).toBe("v=0\r\no=- answer");
    expect(result.callId).toBe("rtc_abc123");

    const request = captured.request;
    expect(request?.url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(request?.init.method).toBe("POST");

    const headers = request?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test-key");
    // 生の student_id ではなくハッシュを送る
    expect(headers["OpenAI-Safety-Identifier"]).toBe("hashed-id");

    const form = request?.init.body as FormData;
    expect(form.get("sdp")).toBe("v=0\r\no=- offer");

    const session = JSON.parse(String(form.get("session")));
    // GA では type: 'realtime' が必須（openai@7.5.0 の型で確認）
    expect(session.type).toBe("realtime");
    expect(session.model).toBe("test-realtime-model");
    expect(session.instructions).toContain("English teacher");
    // 点数を扱う tool を作らない（CLAUDE.md 禁止事項2）
    expect(session.tools).toBeUndefined();
  });

  it("APIキーが無ければ設定エラー。リクエストを送らない", async () => {
    delete process.env.OPENAI_API_KEY;
    const captured: { request?: { url: string; init: RequestInit } } = {};

    await expect(
      createRealtimeCall(
        {
          sdp: "v=0",
          session: buildRealtimeSession({ model: "m" }),
          safetyId: "hashed-id",
        },
        stubFetch(new Response("should not be called"), captured),
      ),
    ).rejects.toBeInstanceOf(OpenAIConfigError);

    expect(captured.request).toBeUndefined();
  });

  it("OpenAI がエラーなら本文を持った例外にする", async () => {
    const captured: { request?: { url: string; init: RequestInit } } = {};

    await expect(
      createRealtimeCall(
        {
          sdp: "v=0",
          session: buildRealtimeSession({ model: "m" }),
          safetyId: "hashed-id",
        },
        stubFetch(
          new Response("invalid model xyz", { status: 400 }),
          captured,
        ),
      ),
    ).rejects.toBeInstanceOf(OpenAIRequestError);
  });
});
