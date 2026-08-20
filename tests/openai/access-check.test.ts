import { afterEach, describe, expect, it, vi } from "vitest";

import { checkOpenAIAccess } from "@/lib/openai/client";

/**
 * npm run doctor が使う事前確認。
 *
 * いちばん大事なのは「キーが誤り」と「そもそも届いていない」を取り違えないこと。
 * 取り違えると、ネットワークの問題をキーの問題として調べ始めてしまう。
 */

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_MODEL = process.env.OPENAI_REALTIME_MODEL;

function setEnv(key: string | undefined, model: string | undefined): void {
  if (key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = key;
  if (model === undefined) delete process.env.OPENAI_REALTIME_MODEL;
  else process.env.OPENAI_REALTIME_MODEL = model;
}

afterEach(() => {
  setEnv(ORIGINAL_KEY, ORIGINAL_MODEL);
});

function modelList(ids: string[]): Response {
  return new Response(
    JSON.stringify({ data: ids.map((id) => ({ id })) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("OpenAI の事前確認", () => {
  it("キーが無ければ no-key", async () => {
    setEnv(undefined, "gpt-realtime-2.1");
    const fetchImpl = vi.fn<typeof fetch>();

    expect(await checkOpenAIAccess(fetchImpl)).toEqual({ kind: "no-key" });
    // キーが無いのにネットワークへ出ない
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("通信そのものが失敗したら unreachable", async () => {
    setEnv("sk-test", "gpt-realtime-2.1");
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });

    const result = await checkOpenAIAccess(fetchImpl);
    expect(result.kind).toBe("unreachable");
  });

  it("プロキシに遮断されたら unreachable（キーのせいにしない）", async () => {
    setEnv("sk-test", "gpt-realtime-2.1");
    // 間に立つプロキシは JSON ではない本文で 403 を返す
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response("Host not in allowlist: api.openai.com", { status: 403 }),
    );

    const result = await checkOpenAIAccess(fetchImpl);
    expect(result.kind).toBe("unreachable");
    if (result.kind === "unreachable") {
      expect(result.detail).toContain("403");
    }
  });

  it("OpenAI が 401 を返したら unauthorized", async () => {
    setEnv("sk-wrong", "gpt-realtime-2.1");
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: "Incorrect API key provided", type: "invalid_request_error" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
    );

    expect(await checkOpenAIAccess(fetchImpl)).toEqual({ kind: "unauthorized" });
  });

  it("キーが通り、設定したモデルが一覧にあれば ok", async () => {
    setEnv("sk-test", "gpt-realtime-2.1");
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      modelList(["gpt-realtime-2.1", "gpt-realtime-mini", "gpt-4o"]),
    );

    const result = await checkOpenAIAccess(fetchImpl);
    expect(result).toEqual({
      kind: "ok",
      hasConfiguredModel: true,
      realtimeModels: ["gpt-realtime-2.1", "gpt-realtime-mini"],
    });
  });

  it("モデル名が一覧に無ければ、使えるものを示せる", async () => {
    setEnv("sk-test", "gpt-realtime-9-nonexistent");
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      modelList(["gpt-realtime-2.1", "gpt-4o"]),
    );

    const result = await checkOpenAIAccess(fetchImpl);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.hasConfiguredModel).toBe(false);
      expect(result.realtimeModels).toEqual(["gpt-realtime-2.1"]);
    }
  });

  it("結果にキーの値を含めない", async () => {
    const secret = "sk-super-secret-value";
    setEnv(secret, "gpt-realtime-2.1");
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("blocked", { status: 403 }),
    );

    const result = await checkOpenAIAccess(fetchImpl);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
