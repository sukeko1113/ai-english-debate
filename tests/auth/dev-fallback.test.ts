import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 開発用の固定生徒へ落ちてよいのは、手元で Google を設定していないときだけ。
 * **本番で落ちてはいけない。** 落ちると、ログインしていない人が
 * 開発用の生徒として授業を始められてしまう。
 */

function setEnv(nodeEnv: string, google: boolean): void {
  vi.stubEnv("NODE_ENV", nodeEnv);
  if (google) {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  } else {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  }
}

afterEach(() => {
  // stubEnv で入れた値はこれで元へ戻る。NODE_ENV は読み取り専用なので直接代入しない
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function usingDevStudent(): Promise<boolean> {
  const auth = await import("@/lib/auth/student");
  return auth.usingDevStudent();
}

describe("開発用の生徒へ落ちる条件", () => {
  it("手元で Google 未設定なら落ちる", async () => {
    setEnv("development", false);
    await expect(usingDevStudent()).resolves.toBe(true);
  });

  it("手元でも Google を設定したら落ちない", async () => {
    setEnv("development", true);
    await expect(usingDevStudent()).resolves.toBe(false);
  });

  it("**本番では絶対に落ちない**（設定が無くても）", async () => {
    setEnv("production", false);
    await expect(usingDevStudent()).resolves.toBe(false);
  });

  it("本番で Google を設定していても落ちない", async () => {
    setEnv("production", true);
    await expect(usingDevStudent()).resolves.toBe(false);
  });
});
