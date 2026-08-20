import { describe, expect, it } from "vitest";

import { buildInstructions, resolvePhase } from "@/lib/openai/instructions";
import type { LessonMaterial, LessonPhase } from "@/lib/db/types";

/**
 * docs/AI教師プロンプト_v03_ClubActivities授業実装用.md の §4 / §11 と
 * docs/REALTIME_ARCHITECTURE.md §3「現在の step の指示だけを入れる」。
 */

const material: LessonMaterial = {
  materialId: "m1",
  level: "intermediate",
  version: "1.0.0",
  topic: {
    id: "t1",
    code: "club-activities",
    titleEn: "Making Club Activities Optional",
    titleJa: "クラブ活動の任意化",
    category: "school_life",
  },
  objectives: ["make A B を理解する"],
  script: "Good morning. I am speaking against making club activities optional.",
  vocabulary: [],
  grammarPoints: [],
  questions: [],
  debateTasks: [],
  counterarguments: [],
  phases: [],
};

const firstPhase: LessonPhase = {
  id: "S00_START",
  section: "Opening",
  labelJa: "授業開始",
  focusSentence:
    "Good morning. I am speaking against making club activities optional.",
  openingJa: "では始めましょう。",
  questions: [
    {
      key: "s00-against",
      askJa: "`against` は賛成と反対のどちらですか？",
      accept: ["反対", "against"],
      hints: ["against は方向を表す語です。", "賛成なら for、反対なら against。"],
      confirmJa: "そうです。反対立論です。",
    },
  ],
};

const secondPhase: LessonPhase = {
  id: "S10_OPENING",
  section: "Opening",
  labelJa: "主張の確認",
  focusSentence: "I am speaking against making club activities optional.",
  openingJa: null,
  questions: [
    {
      key: "s10-optional",
      askJa: "`optional` は必ずやる意味ですか、選べる意味ですか？",
      accept: ["選べる", "任意"],
      hints: ["option と同じ語のなかまです。"],
      confirmJa: "そうです。optional は任意です。",
    },
  ],
};

describe("session instructions", () => {
  it("教材と現在フェーズの質問が入る", () => {
    const text = buildInstructions({
      material,
      phase: firstPhase,
      isLastPhase: false,
    });

    expect(text).toContain("クラブ活動の任意化");
    expect(text).toContain(material.script);
    expect(text).toContain("`against` は賛成と反対のどちらですか？");
    expect(text).toContain("では始めましょう。");
    // ヒントは順に出させる
    expect(text).toContain("ヒント1");
    expect(text).toContain("ヒント2");
  });

  it("先のフェーズの質問を混ぜない", () => {
    const text = buildInstructions({
      material,
      phase: firstPhase,
      isLastPhase: false,
    });

    // docs/REALTIME_ARCHITECTURE.md §3: 現在の step の指示だけを入れる
    expect(text).not.toContain("`optional` は必ずやる意味ですか");
    expect(text).not.toContain("S10_OPENING");
  });

  it("1問ずつ・すぐ答えない・点数を言わない を必ず含む", () => {
    const text = buildInstructions({
      material,
      phase: firstPhase,
      isLastPhase: false,
    });

    expect(text).toContain("1ターンに質問は1つだけ");
    expect(text).toContain("質問した同じターンで正解を言わない");
    expect(text).toContain("ヒント1 → ヒント2 → 正解");
    // CLAUDE.md 禁止事項2。採点はセッション終了後にサーバー側で行う
    expect(text).toContain("点数");
    expect(text).toContain("採点はアプリが行う");
  });

  it("最後のフェーズでは先へ進ませない", () => {
    const text = buildInstructions({
      material,
      phase: secondPhase,
      isLastPhase: true,
    });

    expect(text).toContain("今日はここまで");
    expect(text).toContain("次のセクションへ進まないでください");
  });

  describe("フェーズの決定", () => {
    const phases = [firstPhase, secondPhase];

    it("未設定なら最初のフェーズ", () => {
      expect(resolvePhase(phases, null)?.phase.id).toBe("S00_START");
      expect(resolvePhase(phases, null)?.isLastPhase).toBe(false);
    });

    it("保存されている値を使う（モデルの記憶ではなくアプリの状態が正）", () => {
      const resolved = resolvePhase(phases, "S10_OPENING");
      expect(resolved?.phase.id).toBe("S10_OPENING");
      expect(resolved?.isLastPhase).toBe(true);
    });

    it("教材に無いフェーズ名なら先頭へ戻す", () => {
      expect(resolvePhase(phases, "S999_UNKNOWN")?.phase.id).toBe("S00_START");
    });

    it("フェーズ定義が無い教材では null", () => {
      expect(resolvePhase([], null)).toBeNull();
    });
  });
});
