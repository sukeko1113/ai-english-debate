# AI英語ディベート授業システム

日本の高校生向けの英語ディベート授業システム。生徒は学校の Web アプリを開き、
その画面の中で OpenAI Realtime API による音声 AI 教師と英語の授業を受ける。

基礎学習（語彙・文法・ディクテーション・英作文）から日本語での論拠作成、英語化、
スピーキング、AI とのディベート、評価までを 9 ステップで一体化する。

**生徒は ChatGPT を開かない。** 生徒が触るのはこのアプリだけで、
OpenAI との接続はサーバーが行う。

---

## ドキュメント

実装に着手する前に、最低限 `CLAUDE.md` と `docs/BASIC_DESIGN_v03.md` を読むこと。

| ファイル | 内容 |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | 実装ルールと禁止事項 |
| [`docs/BASIC_DESIGN_v03.md`](./docs/BASIC_DESIGN_v03.md) | 基本設計書 |
| [`docs/LESSON_FLOW.md`](./docs/LESSON_FLOW.md) | 9ステップ授業フロー |
| [`docs/REALTIME_ARCHITECTURE.md`](./docs/REALTIME_ARCHITECTURE.md) | WebRTC接続・function tools・信頼境界 |
| [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) | DB設計 |
| [`docs/API_SPEC.md`](./docs/API_SPEC.md) | HTTP API仕様 |
| [`docs/RUBRIC.md`](./docs/RUBRIC.md) | 評価基準と採点方法 |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | APIキー・権限・未成年データ |
| [`docs/TASKS.md`](./docs/TASKS.md) | Claude Code へのタスク指示 |

---

## 技術構成

| 層 | 採用 |
|---|---|
| フロント | Next.js (App Router) + TypeScript + Tailwind |
| 音声 | OpenAI Realtime API / WebRTC（unified interface） |
| DB | PostgreSQL（Supabase） |
| ホスティング | Vercel |
| 開発 | Claude Code on the web + GitHub |

---

## セットアップ

Node.js 20.9 以上が必要（Next 16 の要件）。

```bash
npm install
cp .env.example .env      # 値を埋める
npm run dev               # http://localhost:3000
```

### ローカルDB（開発用）

Supabase に接続せず、ローカルの PostgreSQL で開発できる。

```bash
npm run db:local        # PostgreSQL 起動 → DB作成 → migration → dev_seed.sql
npm run seed:content    # content/**.json の教材を投入
```

`npm run db:local` は何度実行してもよい（適用済み migration は飛ばす）。
作り直すときは `npm run db:reset`。

その後 `.env` に接続先を書く。

```
DATABASE_URL=postgres://aied:aied@localhost:5432/aied
```

中で何をしているか。

| ファイル | 役割 |
|---|---|
| `supabase/dev/local_auth_shim.sql` | **ローカル専用。** 素の PostgreSQL に無い `auth.uid()` を作る。Supabase では実行しない |
| `supabase/migrations/*.sql` | スキーマ。既存ファイルは書き換えず、新しい番号を足す |
| `supabase/seeds/dev_seed.sql` | ルーブリック v1 と架空のクラス・教師・生徒 |
| `supabase/seeds/seed_content.ts` | `content/**.json` の教材を投入する |

DB を使うテストは `DATABASE_URL` があるときだけ走る。

```bash
DATABASE_URL=postgres://aied:aied@localhost:5432/aied npm run test
```

### コマンド

```bash
npm run dev         # 開発サーバー
npm run build       # 本番ビルド
npm run typecheck   # next typegen + tsc --noEmit
npm run test        # Vitest（tests/**/*.test.ts）
npm run lint        # ESLint
npm run db:local    # ローカルDBの作成・migration・シード
npm run seed:content # 教材JSONの投入
```

コミット前に `npm run typecheck && npm run test` が通ること。

`tests/guards/` には設計ルールを守らせるためのテストが入っている。
`OPENAI_API_KEY` を `lib/openai/client.ts` 以外から読むと `npm run test` が落ちる。

### 現在の実装状況

`docs/TASKS.md` の Task 3 まで。

- `GET /api/lessons/today` / `POST /api/lesson-sessions`
- 生徒画面 `/student` と授業画面 `/student/lesson/[materialId]`（4領域）

**音声はまだ接続していない**（Task 4）。答案の記録も未実装（Task 6）。
認証は `lib/auth/student.ts` の仮実装で、開発用の固定生徒を返す。
本番ビルドでは例外を投げるようにしてある。

Next 16 固有の作法は `node_modules/next/dist/docs/` を参照する。
`next dev` が `CLAUDE.md` へ自動追記するのは `next.config.ts` の `agentRules: false` で止めている。

---

## 開発の進め方

**最初から9ステップ全部を作らない。** 縦に貫通させる。

```
1. 音声往復     WebRTC で「話す→AIが答える」だけ成功させる
2. 教材注入     指定教材に沿って会話させる
3. 保存1件      record_answer を1つだけ動かして DB に入れる
```

この3点が通ってから機能を足す。タスクの順序は [`docs/TASKS.md`](./docs/TASKS.md)。

対象教材は **School Uniforms / beginner のみ**。中級・上級は後。

---

## 特に注意すること

### 音声セッション中に採点しない

Realtime の function tool 呼び出しは WebRTC のデータチャネル経由で
**生徒のブラウザを通る**。引数はすべて改ざん可能。

- セッション中の tool は記録専用。点数を引数に取らない
- 採点はセッション終了後、サーバー側で書き起こしと答案から実行する

詳細は [`docs/REALTIME_ARCHITECTURE.md`](./docs/REALTIME_ARCHITECTURE.md) の「信頼境界」。

### OPENAI_API_KEY をクラウド環境に置かない

Claude Code のクラウド環境変数は、その環境を使う人が誰でも読める。
実際の音声接続テストはローカルで行い、クラウドセッションでは接続部分をモックする。

### 未成年のデータを扱う

音声そのものは保存しない。書き起こしと答案のみ。
学校運用前の確認事項は [`docs/SECURITY.md`](./docs/SECURITY.md) §4 のチェックリスト。

---

## ライセンス / 取り扱い

生徒の実データ、API キー、Supabase の service role キーをコミットしないこと。
テストデータは架空のものを使う。
