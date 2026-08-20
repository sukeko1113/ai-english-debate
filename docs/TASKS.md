# TASKS.md — Claude Code へのタスク指示

claude.ai/code でこのリポジトリを選び、以下を順に投げる。
**1セッション1タスク。** まとめて投げない。

各タスクの冒頭に必ず入れる共通の前置き：

```
まず CLAUDE.md と docs/BASIC_DESIGN_v03.md を読んでください。
禁止事項に該当する実装はしないでください。
```

---

## Task 1: プロジェクト雛形 — Plan モード

```
Next.js (App Router) + TypeScript strict + Tailwind + Vitest でプロジェクトを初期化してください。

- docs/BASIC_DESIGN_v03.md §11 のディレクトリ構成に合わせる
- 各ディレクトリに .gitkeep または最小のindexを置き、構成が見えるようにする
- .env.example に必要な変数名だけを列挙（値は書かない）
- npm run dev / typecheck / test / lint が動く状態にする
- .gitignore に .env を含める
- README.md にセットアップ手順を書く

まだ画面もAPIも実装しないでください。動く土台だけです。
```

**確認**: `npm run typecheck` と `npm run test` が通ること。

---

## Task 2: DBスキーマと教材シード — Plan モード

```
docs/DATA_MODEL.md に従って supabase/migrations/0001_init.sql を作成してください。

- content/school-uniforms/beginner.json を読み込んで DB に投入する
  シードスクリプトを supabase/seeds/ に作る
- lib/db/ に型定義とクエリ関数を置く。Supabase 依存はここに閉じる
- セッション内の PostgreSQL 16 を起動して、migration とシードが
  実際に通ることを確認してください

重要:
- session_answers に score カラムを作らない
- scoring_runs / scores / score_overrides を分離する
- RLS ポリシーは書くが、テーブル定義本体は標準SQLにする
```

**確認**: `psql` でテーブルが作られ、教材が入っていること。

---

## Task 3: 教材取得APIと授業画面（音声なし） — Accept edits

```
docs/API_SPEC.md に従って以下を実装してください。

1. GET /api/lessons/today
   - questions から answer フィールドを必ず除外する
2. POST /api/lesson-sessions
3. app/student/lesson/[materialId]/page.tsx
   - docs/BASIC_DESIGN_v03.md §3.2 の4領域レイアウト
   - 左: 本文・語彙・文法 / 中央: 会話履歴（空でよい）/ 右: 現在Step・回答欄 / 下: 操作ボタン

認証は仮実装で構いません。lib/auth/ に requireStudent() を作り、
今は固定の生徒IDを返すようにして、TODO(要確認) を付けてください。

音声はまだ実装しません。
```

**確認**: ブラウザで教材が表示されること。DevTools の Network で `answer` が
レスポンスに含まれていないこと。

---

## Task 4: Realtime 音声往復のみ — Accept edits

**このタスクが山場。** ここだけは実機で確認が要る。

```
docs/REALTIME_ARCHITECTURE.md に従って、WebRTC で音声を往復させてください。

1. POST /api/realtime/session
   - unified interface 方式（サーバーがSDPを中継）
   - OPENAI_API_KEY は lib/openai/client.ts からのみ読む
   - OpenAI-Safety-Identifier を必ず付ける（生IDではなくハッシュ）
   - モデル名は OPENAI_REALTIME_MODEL 環境変数から
2. components/voice/useRealtimeSession.ts
   - getUserMedia → RTCPeerConnection → SDP交換 → 音声再生
3. 授業画面に「開始」「停止」ボタンとマイク状態表示

instructions はこの段階では固定文字列で構いません:
"You are a friendly English teacher. Greet the student and ask their name."

重要:
- 実装前に https://developers.openai.com/api/docs/guides/realtime-webrtc を確認し、
  GA のエンドポイントとパラメータを使ってください。
  参照した日付とエンドポイントを PR 本文に書いてください
- OPENAI_API_KEY はこのセッション環境に設定されていません。
  接続部分はモックでテストできる形にし、実接続の確認はローカルで行います
```

**確認**: ローカルに `.env` を置いて `npm run dev`。ブラウザで話しかけて返事が返るか。
**ここで barge-in と turn detection の感触を必ず確かめる。**

---

## Task 5: 教材注入とステップ管理 — Accept edits

```
docs/LESSON_FLOW.md に従って、教材と授業手順をモデルに渡してください。

1. lib/openai/instructions.ts
   - buildInstructions(material, session) を純粋関数として実装
   - 現在の step の指示だけを含める（9ステップ全部を入れない）
2. lib/openai/steps.ts
   - LESSON_STEPS の定義。MVP では Step 3c → 5 → 6 → 8 のみ有効にする
3. POST /api/results/step
   - current_step の検証。食い違ったら進めずに警告ログ
4. ステップが進んだら session.update で instructions を差し替える

instructions に「点数を言わない」ルールを必ず含めてください。
```

**確認**: AI が教材の内容に沿って話すか。勝手にステップを飛ばさないか。

---

## Task 6: 記録ツール1つだけ — Accept edits

```
record_answer を1つだけ実装してください。

1. lib/openai/tools.ts に LESSON_TOOLS を定義
   - record_answer のみ。他の tool はまだ追加しない
   - 点数を引数に持たせない
   - session_id を引数に含めない
2. データチャネルの function_call ハンドリング
3. POST /api/results/answer
   - 所有者検証
   - item_id がこのセッションの教材の questions に属することを検証
   - session_answers へ INSERT（ON CONFLICT DO NOTHING）
   - レスポンスは { ok: true } のみ。正誤や点数を返さない

API ルートのテストを tests/ に書いてください。
特に「他人の session_id を渡すと 404」「教材に属さない item_id は拒否」を必ずテストする。
```

**確認**: ディクテーションの答案が DB に入ること。**ここまでで縦の貫通が完了。**

---

## Task 7以降

縦の貫通が確認できたら、以下を順に足す。1タスクずつ。

- `record_argument` と Step 5-6（日本語論拠 → 英語化）
- Step 8 のディベート
- 書き起こしの保存（`/api/results/transcript`）
- 利用量の記録（`/api/results/usage`）
- 確定採点（`lib/scoring/deterministic.ts` + テスト）
- モデル採点（`lib/scoring/model.ts`）と `/finish`
- 採点ばらつきの実測テスト（`tests/scoring/variance.test.ts`）
- 教師画面
- 中級・上級教材の追加

---

## 各タスク共通の確認事項

PR をマージする前に見る。

- [ ] `CLAUDE.md` の禁止事項に触れていないか
- [ ] 点数を引数に持つ tool / API が追加されていないか
- [ ] `process.env.OPENAI_API_KEY` が `lib/openai/client.ts` 以外で参照されていないか
- [ ] `student_id` をリクエストボディから読んでいる箇所がないか
- [ ] DB 変更が migration として追加されているか（既存ファイルの書き換えでないか）
- [ ] `TODO(要確認)` が PR 本文に列挙されているか

---

## クラウド環境の設定

claude.ai/code の環境設定（Default で概ね足りる）。

| 項目 | 値 |
|---|---|
| ネットワーク | Trusted（npm / PyPI / GitHub は通る） |
| 環境変数 | **`OPENAI_API_KEY` を設定しない**（`docs/SECURITY.md` 参照） |
| セットアップスクリプト | 不要。`npm install` は SessionStart フックで |

Supabase に接続する必要が出たら、ネットワークを Custom にして
`*.supabase.co` を追加する。ただし MVP 期間中はセッション内の PostgreSQL 16 で足りる。
