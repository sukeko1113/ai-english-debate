/**
 * 授業を始める前の事前確認。
 *
 *   npm run doctor
 *
 * 音声接続を試す前に、環境・DB・教材・API キーを順に確かめる。
 * 当日その場で原因を切り分けずに済むようにするためのもの。
 *
 * **キーの値は絶対に表示しない。** 有無と長さだけを出す。
 */

// .env を読む。**他の import より前に置くこと**
import "./load_env";

import { closePool, query } from "../lib/db/client";
import { checkOpenAIAccess } from "../lib/openai/client";

type Level = "ok" | "warn" | "ng";

interface Check {
  label: string;
  level: Level;
  detail: string;
  /** 直し方。ng / warn のときだけ出す */
  fix?: string;
}

const MARK: Record<Level, string> = { ok: "✓", warn: "!", ng: "✗" };

const REQUIRED_ENV = [
  "OPENAI_API_KEY",
  "OPENAI_REALTIME_MODEL",
  "SAFETY_ID_SALT",
  "DATABASE_URL",
] as const;

function checkNode(): Check {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((part) => Number(part));
  const ok = major > 20 || (major === 20 && minor >= 9);

  return {
    label: "Node.js のバージョン",
    level: ok ? "ok" : "ng",
    detail: `v${process.versions.node}`,
    fix: ok ? undefined : "Next 16 は Node.js 20.9 以上が必要。更新すること",
  };
}

function checkEnv(): Check[] {
  return REQUIRED_ENV.map((name): Check => {
    const value = process.env[name];
    if (!value) {
      return {
        label: name,
        level: "ng",
        detail: "未設定",
        fix:
          name === "DATABASE_URL"
            ? "npm run db:apply が表示する接続先を .env に書く"
            : ".env に値を入れる（README「セットアップ」参照）",
      };
    }
    // 値そのものは出さない。長さだけ
    return { label: name, level: "ok", detail: `設定あり（${value.length}文字）` };
  });
}

async function checkDatabase(): Promise<Check[]> {
  if (!process.env.DATABASE_URL) {
    return [
      {
        label: "DB への接続",
        level: "ng",
        detail: "DATABASE_URL が無いので確認できない",
        fix: ".env に DATABASE_URL を書く",
      },
    ];
  }

  try {
    await query("select 1");
  } catch (error) {
    return [
      {
        label: "DB への接続",
        level: "ng",
        detail: error instanceof Error ? error.message : String(error),
        fix: "PostgreSQL が起動しているか、DATABASE_URL が正しいかを確認する",
      },
    ];
  }

  const checks: Check[] = [
    { label: "DB への接続", level: "ok", detail: "つながった" },
  ];

  const tables = await query<{ count: string }>(
    `select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'lesson_sessions'`,
  );
  if (Number(tables[0]?.count ?? 0) === 0) {
    checks.push({
      label: "migration",
      level: "ng",
      detail: "テーブルが無い",
      fix: "npm run db:apply を実行する",
    });
    return checks;
  }
  checks.push({ label: "migration", level: "ok", detail: "適用済み" });

  const material = await query<{
    code: string;
    level: string;
    phases: number;
  }>(
    `select t.code, m.level, jsonb_array_length(m.lesson_phases) as phases
       from materials m join topics t on t.id = m.topic_id
      where t.code = 'club-activities'`,
  );

  const found = material[0];
  if (!found) {
    checks.push({
      label: "教材（Club Activities）",
      level: "ng",
      detail: "入っていない",
      fix: "npm run seed:content を実行する",
    });
  } else if (found.phases < 2) {
    checks.push({
      label: "教材（Club Activities）",
      level: "ng",
      detail: `フェーズが ${found.phases} 件しかない`,
      fix: "npm run seed:content を実行し直す",
    });
  } else {
    checks.push({
      label: "教材（Club Activities）",
      level: "ok",
      detail: `${found.level} / フェーズ ${found.phases} 件`,
    });
  }

  const students = await query<{ count: string }>(
    `select count(*) from students`,
  );
  const studentCount = Number(students[0]?.count ?? 0);
  checks.push({
    label: "開発用の生徒",
    level: studentCount > 0 ? "ok" : "ng",
    detail: `${studentCount} 人`,
    fix: studentCount > 0 ? undefined : "npm run db:apply を実行する",
  });

  return checks;
}

async function checkOpenAI(): Promise<Check[]> {
  const configured = process.env.OPENAI_REALTIME_MODEL ?? "";
  const result = await checkOpenAIAccess();

  switch (result.kind) {
    case "no-key":
      return [
        {
          label: "OpenAI への疎通",
          level: "ng",
          detail: "OPENAI_API_KEY が無い",
          fix: ".env に OPENAI_API_KEY を入れる",
        },
      ];
    case "unreachable":
      return [
        {
          label: "OpenAI への疎通",
          level: "ng",
          detail: `到達できない（${result.detail}）`,
          fix: "ネットワーク・プロキシ・ファイアウォールを確認する。キーの正誤はここでは判定できない",
        },
      ];
    case "unauthorized":
      return [
        {
          label: "OpenAI への疎通",
          level: "ng",
          detail: "キーが受け付けられなかった（401/403）",
          fix: "キーが正しいか、支払い方法が登録されているかを確認する",
        },
      ];
    case "error":
      return [
        {
          label: "OpenAI への疎通",
          level: "warn",
          detail: `想定外の応答（HTTP ${result.status}）`,
          fix: "少し待って再実行する。続くようなら OpenAI 側の状況を確認する",
        },
      ];
    case "ok": {
      const checks: Check[] = [
        { label: "OpenAI への疎通", level: "ok", detail: "キーが通った" },
      ];
      if (result.hasConfiguredModel) {
        checks.push({
          label: "Realtime モデル",
          level: "ok",
          detail: `${configured} が使える`,
        });
      } else {
        checks.push({
          label: "Realtime モデル",
          level: "ng",
          detail: `${configured || "(未設定)"} はこのアカウントの一覧に無い`,
          fix:
            result.realtimeModels.length > 0
              ? `使えるのは: ${result.realtimeModels.join(", ")}`
              : "このアカウントで使える realtime モデルが見つからない。契約状況を確認する",
        });
      }
      return checks;
    }
  }
}

function print(checks: Check[]): number {
  let ng = 0;
  for (const check of checks) {
    if (check.level === "ng") ng += 1;
    console.log(`  ${MARK[check.level]} ${check.label}: ${check.detail}`);
    if (check.fix && check.level !== "ok") {
      console.log(`      → ${check.fix}`);
    }
  }
  return ng;
}

async function main(): Promise<void> {
  let ng = 0;

  console.log("環境");
  ng += print([checkNode(), ...checkEnv()]);

  console.log("");
  console.log("データベース");
  ng += print(await checkDatabase());

  console.log("");
  console.log("OpenAI");
  ng += print(await checkOpenAI());

  console.log("");
  if (ng === 0) {
    console.log("すべて確認できた。npm run dev で始められる");
  } else {
    console.log(`${ng} 件を直してから始めること`);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
