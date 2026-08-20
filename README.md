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

### 別の PC で動かす

デプロイはせず、その PC で `npm run dev` を動かす前提。**認証は仮実装のままなので、
公開せずローカルでのみ使うこと**（`NODE_ENV=production` では例外を投げる）。

**1. Node.js 20.9 以上と PostgreSQL 16 を入れる**

| OS | PostgreSQL の用意 |
|---|---|
| macOS | `brew install postgresql@16 && brew services start postgresql@16` |
| Windows | 公式インストーラを入れる（インストール時のパスワードを控える） |
| Linux | `npm run db:local` が起動から DB 作成まで行う |

**2. リポジトリを用意して DB を作る**

```bash
git clone <このリポジトリ> && cd ai-english-debate
npm install
createdb aied                    # Windows は pgAdmin か psql から作成
```

**3. `.env` を書く**

```
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
SAFETY_ID_SALT=（openssl rand -hex 32 の出力）
DATABASE_URL=postgres://ユーザー:パスワード@localhost:5432/aied
```

**4. スキーマと教材を入れる**

```bash
npm run db:apply       # OS を問わない。shim → migration → dev_seed
npm run seed:content   # 教材 JSON の投入
```

**5. 事前確認**

```bash
npm run doctor
```

環境・DB・教材・API キーを順に確認し、足りないものと直し方を出す。
**キーが正しいかどうかも、音声接続を試す前にここで分かる。**
すべて緑になってから `npm run dev` を実行する。

### API キーを他人の PC に置くときの注意

`.env` を置くと、**その PC を使える人はキーを読める。**

- **この用途専用のキーを発行し、終わったら失効させる**
- OpenAI Platform で月額のハードリミットを入れる（`docs/SECURITY.md` §1）
- アプリ側のレート制限（`REALTIME_SESSIONS_PER_HOUR`、既定6）だけに頼らない

### コマンド

```bash
npm run dev         # 開発サーバー
npm run build       # 本番ビルド
npm run typecheck   # next typegen + tsc --noEmit
npm run test        # Vitest（tests/**/*.test.ts）
npm run lint        # ESLint
npm run doctor      # 事前確認（環境・DB・教材・APIキー）
npm run db:local    # ローカルDBの作成・migration・シード（Linux 専用）
npm run db:apply    # migration とシードの適用のみ（OS 非依存）
npm run seed:content # 教材JSONの投入
```

コミット前に `npm run typecheck && npm run test` が通ること。

`tests/guards/` には設計ルールを守らせるためのテストが入っている。
`OPENAI_API_KEY` を `lib/openai/client.ts` 以外から読むと `npm run test` が落ちる。

### 現在の実装状況

`docs/TASKS.md` の Task 6 ＋ Take5（Club Activities 教材の最小授業）まで。
**「音声往復 → 教材注入 → 保存1件」の縦の貫通は完了。**

- `GET /api/lessons/today` / `POST /api/lesson-sessions`
- 生徒画面 `/student` と授業画面 `/student/lesson/[materialId]`（4領域）
- `POST /api/realtime/session`（WebRTC の SDP 中継）と授業画面の「開始」「停止」

- Club Activities 教材と AI教師プロンプト v03 を Realtime session へ注入
  （`lib/openai/instructions.ts`。**現在フェーズの1問だけ**を渡す）

- `POST /api/results/answer` と `record_answer` tool（記録専用・点数を扱わない）
- `POST /api/results/phase` と `mark_phase_complete` tool（フェーズを進める）
- `POST /api/results/transcript`（書き起こしの保存と、中央ペインへの表示）
- 確定採点 `lib/scoring/`（ディクテーションの文字列照合。純粋関数）
- `POST /api/results/usage`（利用量の記録。授業単価を出すため）
- `POST /api/lesson-sessions/:id/finish` と `GET .../result`（採点の実行と取得）

**進行を決めるのはアプリで、モデルではない。** モデルが違うフェーズの完了を
主張しても `current_phase` は動かず、警告ログだけが残る。

利用量は応答ごとに足し込む。**モデル名はブラウザの申告を使わず**、
接続時に `realtime_calls` へ記録した値を使う（費用計算に直結するため）。
`connected_seconds` はサーバーの時計で出す。

**単価表 `lib/openai/pricing.ts` は空**。推測の値を入れていないので、
`estimated_cost_usd` は単価を入れるまで空のまま。トークン数と接続時間は
記録され続けるので、後から単価を入れて再計算できる。

### 採点

`/finish` が確定採点（同期）→ モデル採点（失敗しても確定採点は残す）の順に走り、
`scoring_runs` / `scores` へ書く。**点数はサーバーが計算する。**
ブラウザからもモデルからも点数を受け取らない。

決めたこと:

- **満点は 85 点。** MVP では Speaking（15点）を採点しないため。
  この 85 は定数ではなく `rubrics` テーブルから出す
  （`scorer_kind = 'record_only'` の軸を合計から外す）
- **確定採点は最初の試行を採点する。** 未回答は不正解として分母に数える
  （飛ばした方が得になってはいけない）

`/result` は2つの分母を返す。`maxScore` はルーブリック上の満点、
`assessedMaxScore` は**今回実際に採点できた配点**。
**生徒に見せる割合は後者を分母にする。** モデル採点が動いていない軸まで
「取れなかった点」に見せないため。

**未解決**: `docs/RUBRIC.md` は Language Accuracy を「確定10 + モデル10」と
しているが、`rubrics` は1軸1行で `scorer_kind` を1つしか持てず、
いまはモデル側の10点を誰も採点していない（`assessedMax` に表れる）。

書き起こしは接続のたびに保存し、**seq はサーバーが採番する**。
ブラウザの採番をそのまま使うと、再接続で振り出しに戻ったときに
既存の行とぶつかって新しい行が捨てられるため。
授業画面を開き直しても、保存済みの会話履歴が中央ペインに出る。
**音声そのものは保存しない**（`docs/SECURITY.md` §4）。

フェーズの instructions には受理する答えとヒントが入っているので、
**ブラウザには返さない**（`docs/SECURITY.md` §2）。モデルへはサーバーから
OpenAI へ直接渡し、ブラウザが受け取るのは次のフェーズの名前だけ。

`record_answer` は **questions を持つ教材のセッションにだけ渡す**。
Club Activities（Take5）は書く課題を持たないため tool は渡らない。
動作を見るには School Uniforms の教材でセッションを作る。

Take5 で有効な授業フェーズは **S00_START と S10_OPENING のみ**。
Signpost 以降・ディクテーション・英作文・論拠作成・ミニディベート・採点・教師画面は未実装。
フェーズを次へ進める function tool も未実装（Task 6）で、いまは
`lesson_sessions.current_phase` を接続時に保存し、再接続時にそこから組み直す。
答案の記録も未実装（Task 6）。
認証は `lib/auth/student.ts` の仮実装で、開発用の固定生徒を返す。
本番ビルドでは例外を投げるようにしてある。

### 音声接続をローカルで試す

**クラウドセッションでは試せない。** `OPENAI_API_KEY` をクラウド環境変数に
置かない方針のため（`docs/SECURITY.md` §1）。手元で次を行う。

```bash
cp .env.example .env
#   OPENAI_API_KEY         サーバー専用のキー
#   OPENAI_REALTIME_MODEL  Realtime のモデル名（コードに直書きしない）
#   SAFETY_ID_SALT         Safety Identifier のハッシュ用ソルト
#   DATABASE_URL           npm run db:local が最後に表示する値

npm run dev
# /student →「AI授業を開始」→ 授業画面の下部「開始」→ マイクを許可
```

確かめること（`docs/TASKS.md` Task 4）:

- 話しかけて返事が返るか
- **barge-in**（AI が話している最中に割り込めるか）
- **turn detection** の感触。待ってくれない / 喋り出さない場合は
  `lib/openai/session-config.ts` の `TURN_DETECTION` を調整する

接続1回につき `realtime_calls` に1行入る。1時間あたりの上限は
`REALTIME_SESSIONS_PER_HOUR`（既定 6）。超えると 429 になる。

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
