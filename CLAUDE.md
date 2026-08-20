# CLAUDE.md — 実装ルール

このリポジトリで作業するときは、まず `docs/BASIC_DESIGN_v03.md` を読むこと。
授業の進め方は `docs/AI教師プロンプト_v03_ClubActivities授業実装用.md` が基準仕様。
迷ったら設計書が正。設計書と矛盾する実装をしそうになったら、実装せずに指摘する。

**AI教師プロンプト v03 §9 の保存例は、そのまま実装しない。**
`save_lesson_result` はモデルに点数を作らせる形になっており、下の禁止事項2に反する。
記録専用（点数なし・`lesson_id` はサーバー側で確定）に読み替えること。

---

## プロジェクト概要

日本の高校生向け「AI英語ディベート授業システム」。
生徒は学校の Web アプリを開き、その画面の中で OpenAI Realtime API の音声 AI 教師と
英語の授業を受ける。基礎学習（語彙・文法・ディクテーション・英作文）から
日本語での論拠作成、英語化、スピーキング、AI とのディベート、評価までを 9 ステップで通す。

**生徒は ChatGPT を開かない。** 生徒が触るのはこの Web アプリだけ。

---

## 絶対にやらないこと

### 1. ChatGPT の Web UI を操作しない
ブラウザ自動化・スクレイピング・非公式 API で ChatGPT を操作する実装は一切しない。
音声は OpenAI Realtime API を公式の方法で使う。

### 2. 音声セッション中に採点しない
**これは最重要ルール。**

Realtime の function tool 呼び出しは、WebRTC のデータチャネル経由で
**生徒のブラウザを通る**。したがってブラウザから来る値はすべて改ざん可能である。

- セッション中の tool は **記録専用**。点数を引数に取る tool を作らない
- 採点はセッション終了後、サーバー側で書き起こしと答案から行う
- `save_quiz_result(score)` のように、モデルが点数を決めて渡す設計にしない

詳細は `docs/REALTIME_ARCHITECTURE.md` の「信頼境界」と `docs/RUBRIC.md`。

### 3. ブラウザ由来の値を検証せずに保存しない
- `student_id` はモデルやクライアントから受け取らない。認証セッションから引く
- `session_id` は所有者を必ず検証してから使う
- `item_id` / `question_id` は DB に存在し、かつその session の教材に属することを確認する

### 4. OPENAI_API_KEY をサーバーの外に出さない
- クライアントコンポーネント、`NEXT_PUBLIC_*`、ログ、エラーメッセージに含めない
- キーを使うのは `app/api/realtime/**` のサーバーコードだけ

### 5. 秘密情報と生徒実データをコミットしない
- `.env` は `.gitignore`。`.env.example` には変数名のみ
- 実在の生徒名・音声・成績をリポジトリに入れない。テストは架空データで

### 6. Supabase 固有機能に深く依存しない
将来 GCP 等へ移行する可能性がある。素の PostgreSQL と標準 SQL で書く。
Edge Functions にビジネスロジックを置かない。DB アクセスは `lib/db/` に集約する。

### 7. 教材をコードに埋め込まない
教材の追加・修正でコード変更が必要にならない構造にする。
教材は DB（開発中は `content/**.json`）から読む。

---

## 実装の順序

**最初から 9 ステップ全部を作らない。** 縦に貫通させる。

```
1. 音声往復     WebRTC で「話す→AIが答える」だけ成功させる
2. 教材注入     指定教材に沿って会話させる
3. 保存 1 件    record_answer を 1 つだけ動かして DB に入れる
```

この 3 点が通ってから機能を足す。詳細は `docs/TASKS.md`。

対象教材は次の2つ。他テーマ・他レベルはまだ増やさない。

- **Club Activities / intermediate**（`content/club-activities/against-intermediate.json`）
  AI教師プロンプト v03 の授業。S00_START〜S80_LOGIC_CHECK と S110〜S140 が有効。
  S90_DICTATION と S100_WRITING（タイピングが要る2つ）は未実装
- **School Uniforms / beginner**（`content/school-uniforms/beginner.json`）
  Task 1〜4 で使った最小教材

---

## 技術方針

| 項目 | 決定 |
|---|---|
| フレームワーク | Next.js (App Router) + TypeScript strict |
| 音声接続 | Realtime API / WebRTC / **unified interface**（サーバーが SDP を中継） |
| モデル名 | `OPENAI_REALTIME_MODEL` 環境変数。コードに直書きしない |
| DB | Supabase (PostgreSQL)。開発中はローカル Postgres で可 |
| スタイル | Tailwind |
| テスト | Vitest。API ルートと採点ロジックは必ずテストを書く |

授業の進行状態（現在 step、再挑戦回数）は **アプリ側が保持する**。
モデルの記憶に依存しない。接続が切れても `lesson_sessions` から再開できること。

---

## コードの置き場所

```
app/student/        生徒画面
app/teacher/        教師画面
app/api/realtime/   Realtime セッション初期化（APIキーを使う唯一の場所）
app/api/lessons/    教材取得
app/api/results/    結果保存
lib/openai/         Realtime 接続設定、instructions 生成
lib/db/             DB アクセス（Supabase 依存をここに閉じる）
lib/scoring/        採点ロジック（純粋関数。副作用を持たせない）
lib/auth/           認証・権限
supabase/migrations/ スキーマ変更は必ず migration として残す
content/            教材 JSON
```

---

## 作業の進め方

- `main` に直接大きな変更を入れない。機能ごとにブランチと PR
- DB 変更は必ず `supabase/migrations/` に SQL を追加する。既存 migration を書き換えない
- 型は `any` を使わない。Realtime のイベント型は `lib/openai/types.ts` に定義する
- コミット前に `npm run typecheck && npm run test` が通ること
- 実装が設計書のどの節に対応するか、PR 本文に書く

## 分からないときは

推測で進めず、以下のどれかをする。

1. `docs/` の該当ファイルを読む
2. それでも決まらなければ、選択肢と判断材料を提示して確認を求める
3. 仮実装する場合は `// TODO(要確認):` を付けて、PR 本文に列挙する

特に **セキュリティ・採点・個人情報に関わる判断は、勝手に決めない。**
