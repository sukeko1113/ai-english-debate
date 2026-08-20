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

```bash
npm install
cp .env.example .env      # 値を埋める
npm run dev
```

### ローカルDB（開発用）

Supabase に接続せず、ローカルの PostgreSQL で開発できる。

```bash
service postgresql start          # Claude Code のクラウドセッション内
createdb aied
psql aied -f supabase/migrations/0001_init.sql
psql aied -f supabase/seeds/dev_seed.sql
```

### コマンド

```bash
npm run dev         # 開発サーバー
npm run typecheck   # 型チェック
npm run test        # テスト
npm run lint
```

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
