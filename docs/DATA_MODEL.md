# DATA_MODEL.md — データモデル

実際の DDL は `supabase/migrations/0001_init.sql`。本書は設計意図を説明する。

---

## 設計の中心にある考え方

### 答案と採点を分離する

```
session_answers （生答案・不変）
      ↓
scoring_runs （いつ・何で・どの基準で採点したか）
      ↓
scores （採点結果。再採点すると行が増える）
      ↓
score_overrides （教員修正）
```

同じ答案に対して採点が複数回ありうる。理由は3つ。

1. **ルーブリックを改善したとき、過去分を再採点できる。** 学期途中で基準を直しても、
   全員を同じ基準に揃え直せる
2. **採点器モデルを変えたとき、影響範囲が分かる。** 旧採点と新採点を並べて比較できる
3. **監査できる。** 「なぜこの点数か」が、どの採点実行のどの基準によるものか辿れる

答案テーブルに `score` カラムを持たせると、この3つが全部できなくなる。

### 教材とコードを分離する

教材を追加するときにコード変更が要らないこと。
`questions.type` で処理が分岐する箇所は、新しい type を追加できる形にする。

---

## テーブル一覧

### 教材系（教員が編集）

| テーブル | 用途 |
|---|---|
| `topics` | ディベートテーマ |
| `materials` | レベル別の本文・到達目標 |
| `vocabulary` | 重要語彙 |
| `grammar_points` | 文法ポイント |
| `questions` | 理解・ディクテーション・英作文の問題 |
| `debate_tasks` | 論拠・ディベート課題 |
| `rubrics` | 評価軸と配点（バージョン付き） |
| `lesson_prompts` | AI 教師への授業指示（バージョン付き） |

### 学習記録系（授業中に書き込まれる。すべて不変）

| テーブル | 用途 |
|---|---|
| `students` | 生徒 |
| `classes` | クラス |
| `lesson_sessions` | 1回の授業 |
| `session_answers` | 生答案。**採点結果を持たない** |
| `session_arguments` | 日本語論拠と英語版 |
| `session_steps` | ステップ通過記録 |
| `session_transcript` | 会話の書き起こし |
| `session_usage` | API 利用量 |

### 採点系（セッション終了後に書き込まれる）

| テーブル | 用途 |
|---|---|
| `scoring_runs` | 採点の実行単位 |
| `scores` | 評価軸ごとの点数 |
| `score_overrides` | 教員による修正 |
| `progress` | 継続到達度 |
| `audit_logs` | 変更履歴 |

---

## 主要テーブルの詳細

### `lesson_sessions`

授業1回。**授業の進行状態はここが正。** モデルの記憶ではない。

```
id                uuid PK
student_id        uuid FK → students
material_id       uuid FK → materials
rubric_version    text        採点時に使うルーブリックを開始時に固定
prompt_version    text        使用した lesson_prompts のバージョン
current_step      int         1..9。アプリが管理
status            text        in_progress | finished | abandoned | scoring
started_at        timestamptz
finished_at       timestamptz
```

`rubric_version` を開始時に固定するのが要点。授業の途中でルーブリックが更新されても、
その授業は開始時の基準で採点される。

### `session_answers`

```
id                uuid PK
session_id        uuid FK → lesson_sessions
question_id       uuid FK → questions
attempt_no        int
answer_text       text        生徒が言った・書いたそのまま
hint_used         boolean
recorded_at       timestamptz

UNIQUE (session_id, question_id, attempt_no)
```

- **`score` カラムを追加しない**
- `answer_text` は訂正しない。モデルに直させた版ではなく、生徒が最初に言った内容
- UNIQUE 制約は再接続時の二重記録を防ぐ

### `scoring_runs`

```
id                uuid PK
session_id        uuid FK → lesson_sessions
rubric_version    text
scorer_kind       text        deterministic | model | teacher
scorer_model      text        モデル採点のときのモデル名とバージョン
scorer_prompt_ver text
run_at            timestamptz
is_current        boolean     この session の現在有効な採点か
```

再採点すると新しい run が作られ、古い run の `is_current` が false になる。
**削除しない。** 過去の採点履歴は残す。

### `scores`

```
id                uuid PK
scoring_run_id    uuid FK → scoring_runs
axis              text        language_accuracy | comprehension | speaking |
                              claim | reasoning | interaction | improvement
raw_score         numeric
max_score         numeric
evidence          jsonb       根拠。どの答案・どの発言を見たか
```

`evidence` が重要。教員が「なぜこの点数か」を確認できないと、修正の判断ができない。

### `score_overrides`

```
id                uuid PK
scoring_run_id    uuid FK → scoring_runs
axis              text
teacher_id        uuid FK
new_score         numeric
reason            text
created_at        timestamptz
```

元の `scores` を書き換えない。上書きは別テーブルに積む。
最終成績は「`scores` に `score_overrides` を適用した結果」として計算する。

### `session_usage`

```
session_id            uuid PK FK → lesson_sessions
model                 text
audio_input_tokens    bigint
audio_output_tokens   bigint
text_input_tokens     bigint
text_output_tokens    bigint
connected_seconds     int
estimated_cost_usd    numeric
```

Step 11 の実証で「1授業あたりいくらか」を出すための表。
`estimated_cost_usd` は記録時のレートで計算し、レート表は `lib/openai/pricing.ts` に持つ。

### `session_transcript`

```
id                uuid PK
session_id        uuid FK
seq               int
speaker           text        student | tutor
text              text
started_at_ms     int         セッション開始からの相対ミリ秒
```

音声そのものは保存しない。`started_at_ms` は Speaking / Interaction の採点で
間の取り方を見るために使う。

---

## 権限（RLS）

Supabase の Row Level Security を使う。ただし **RLS だけに依存しない。**
API 層でも必ず所有者を検証する（二重防御）。

| テーブル | 生徒 | 教師 |
|---|---|---|
| `materials` 等の教材系 | 自分に割り当てられたもののみ SELECT | 担当クラスの範囲で SELECT / UPDATE |
| `lesson_sessions` | 自分の行のみ | 担当クラスの生徒の行 |
| `session_answers` | 自分のセッションのみ INSERT / SELECT | 担当クラスの生徒の行 SELECT |
| `scores` | 自分の行 SELECT のみ | 担当クラスの生徒の行 SELECT |
| `score_overrides` | アクセス不可 | 担当クラスのみ INSERT |
| `audit_logs` | アクセス不可 | SELECT のみ |

**生徒は `scores` に INSERT できない。** 採点はサーバーの service role でのみ書き込む。

---

## 開発中の扱い

Claude Code のクラウドセッションには PostgreSQL 16 がプリインストールされている。
Supabase に接続せず、ローカルの Postgres に `0001_init.sql` を流して開発する。

```bash
service postgresql start
createdb aied
psql aied -f supabase/migrations/0001_init.sql
psql aied -f supabase/seeds/dev_seed.sql
```

Supabase 固有の記法（`auth.uid()` 等）は RLS ポリシー内に閉じ込め、
テーブル定義本体は標準 SQL で書く。将来の移行コストを下げるため。

---

## マイグレーションの規則

- **既存の migration ファイルを書き換えない。** 常に新しい番号のファイルを追加する
- ファイル名は `NNNN_短い説明.sql`
- `DROP TABLE` を含む変更は、事前に確認を求める
- seed データは `supabase/seeds/` に分ける。migration に混ぜない
