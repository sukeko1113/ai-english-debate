# AI英語ディベート授業システム 基本設計書 v03

独自Webアプリ × OpenAI Realtime API × 教材・成績DB × Claude Code on the web

作成日：2026年8月20日
開発前提：Claude Code on the web ＋ GitHub

> **v03の最大変更点**
> ChatGPT の Web / デスクトップ画面を外部から操作する設計を中止し、生徒が使う独自 Web アプリの中に
> OpenAI Realtime API による音声 AI 教師を組み込む。教材・進捗・成績は同じ Web アプリの
> バックエンドで一元管理する。

---

## 0. v03の結論と設計判断

> **結論**
> 生徒は「ChatGPTアプリ」を開かない。学校用の AI 英語ディベート Web アプリを開き、
> その画面の中で OpenAI の Realtime 音声 AI と会話する。これにより、音声授業・教材提示・
> 回答入力・学習履歴・成績保存を同じシステムで扱える。

### 0.1 v02から何を変えたか

| 項目 | v02 | v03（採用案） |
|---|---|---|
| 授業フロント | ChatGPT Web / Desktop を中心に利用 | 独自 Web アプリを授業フロントとする |
| 音声AI | ChatGPT Voice / Live | OpenAI Realtime API を WebRTC で接続 |
| 教材受け渡し | ChatGPT App / MCP 等を検討 | バックエンド DB から教材 JSON を取得し Realtime session へ渡す |
| 成績保存 | MCP / 補助ポータル等を検討 | Realtime function tool → バックエンド API → DB |
| APIキー | ChatGPT 側の機能に依存 | 通常 API キーはサーバーのみ。ブラウザへ露出させない |
| 生徒操作 | ChatGPT と学習ポータルを行き来 | 原則1つの Web 画面で完結 |
| 開発 | Claude Code on the web | 同じ。GitHub を中心に継続 |

### 0.2 採用する全体像

```
生徒PC（Edge / Chrome ＋ ヘッドセット）
   ↓
AI英語ディベートWebアプリ（Next.js / TypeScript）
   ↓
OpenAI Realtime API（音声AI教師）
   ↓
アプリバックエンド（認証・教材・セッション・評価API）
   ↓
Supabase / PostgreSQL（教材DB・学習履歴DB・成績DB）

開発： Claude Code on the web ←→ GitHub ←→ Vercel / Supabase
```

### 0.3 v03本文からの変更点（実装時の確定事項）

本設計書 v03 の記述のうち、実装にあたり以下を確定・修正する。

| 箇所 | v03本文 | 実装時の扱い | 理由 |
|---|---|---|---|
| §6.1 function tools | `save_quiz_result(score)` 等、モデルが点数を渡す | **記録専用ツールに変更。点数は渡さない** | tool 呼び出しはブラウザを経由するため点数が改ざん可能 |
| §6.1 `save_debate_result` | セッション中にルーブリック保存 | **セッション終了後にサーバー側で採点** | 同上。加えて採点基準の一貫性・再採点可能性のため |
| §8 データモデル | 答案と採点が同一テーブル | **`session_answers` と `scores` を分離** | 再採点・監査・教員修正履歴のため |
| §13 コスト | 「session 単位で記録」 | **`session_usage` テーブルを追加** | 席課金 vs 従量課金の比較材料 |
| §4 接続 | Safety Identifier の記述なし | **`OpenAI-Safety-Identifier` を必須化** | 後付けが困難なため初期実装に含める |

詳細は `docs/REALTIME_ARCHITECTURE.md`、`docs/DATA_MODEL.md`、`docs/RUBRIC.md`。

---

## 1. 教育目的と授業設計

### 1.1 目的

生徒一人ひとりの英語力に合わせ、AI が個別教師のように音声で授業を進める。
単語・文法・ディクテーション・英作文などの基礎学習を、最終的な
「自分の意見を英語で述べ、相手に反論する」ディベート活動へつなげる。

### 1.2 1テーマの標準9ステップ

| Step | 活動 | 内容 |
|---|---|---|
| 1 | レベル判定 | 初級・中級・上級など現在の到達度を確認 |
| 2 | 教材提示 | ディベートにつながる短い本文・モデルスクリプトを提示 |
| 3 | 基礎学習 | 語彙、文法、内容理解、ディクテーション、音読、英作文 |
| 4 | 理解度確認 | AI が質問し、誤答時はヒント→再説明→再挑戦 |
| 5 | 論拠作成（日本語） | 賛成／反対を決め、「なぜなら」を2〜3個作る |
| 6 | 英語化 | AI が生徒のレベルに合わせて英語表現を支援 |
| 7 | スピーキング | 自分の論拠を声に出し、言い直し・発音・文法を練習 |
| 8 | AIディベート | AI が反対側を担当し、反論・再反論を練習 |
| 9 | 評価・振り返り | 共通ルーブリックで評価し、次の教材へつなぐ |

各ステップの詳細指示と完了条件は `docs/LESSON_FLOW.md`。

### 1.3 同じテーマをレベル別にする

| レベル | 教材 | 到達目標 | ディベート |
|---|---|---|---|
| 初級 | 短文・基本語彙・基本文法 | 簡単な理由を2つ言える | 短い賛否＋1回の応答 |
| 中級 | 複文・理由説明・接続表現 | 理由を説明し簡単な反論ができる | 反論→再説明 |
| 上級 | 抽象語彙・複数根拠・比較 | 根拠を深め反論・再反論ができる | 複数ターン |

> **設計原則**
> 教材難易度は変えても、テーマと評価軸は共有する。個別最適化と成績評価の公平性を両立する。

---

## 2. 教材設計と教材データベース

### 2.1 「教員承認教材＋AI補助生成」

- **固定部分**：テーマ、レベル、モデル英文、重要語彙、文法ポイント、必須問題、英作文課題、ディベート課題、ルーブリック
- **AI生成部分**：追加例文、別の説明、難易度調整、追加練習、反論例

成績に影響する必須問題・採点基準は AI が授業ごとに勝手に変更しない。
授業中に生成された良質な教材は「候補」として保存し、教員承認後に教材 DB へ追加する。

### 2.2 最小教材データ構造

| テーブル | 主な項目 | 役割 |
|---|---|---|
| `topics` | id, title_en, title_ja, category, status | ディベートテーマ |
| `materials` | id, topic_id, level, version, script, objectives | レベル別本文・到達目標 |
| `vocabulary` | material_id, word, meaning, example | 重要語彙 |
| `grammar_points` | material_id, point, explanation, examples | 文法ポイント |
| `questions` | material_id, type, prompt, answer, score | 理解・ディクテーション・英作文 |
| `debate_tasks` | topic_id, level, side, prompt, constraints | 論拠・ディベート課題 |
| `rubrics` | rubric_id, axis, max_score, descriptors | 評価基準 |
| `lesson_prompts` | material_id, system_instruction, version | AI 教師への授業指示 |

完全な定義は `docs/DATA_MODEL.md`。

### 2.3 AIへ渡す教材は「ファイル」よりJSONを基本にする

Word / PDF を毎回 AI へアップロードする設計ではなく、教材 DB の内容をサーバーが構造化 JSON として
取り出し、授業開始時の session instructions や会話コンテキストに変換する。
Word / PDF は教員が教材を作る入口として残してよい。

```json
{
  "topic": "School Uniforms",
  "level": "beginner",
  "objectives": ["becauseで理由を言う", "理由を2つ述べる"],
  "script": "School uniforms are common ...",
  "grammar": ["I think ...", "because ...", "should ..."],
  "lesson_steps": ["vocabulary", "grammar", "dictation", "writing", "argument", "debate"]
}
```

実際の教材例は `content/school-uniforms/beginner.json`。

---

## 3. 生徒用フロントエンド

### 3.1 生徒は何を操作するか

1. 学校の学習サイト URL を開く
2. 学校アカウントでログインする
3. 「今日の授業」を選ぶ
4. 「AI授業を開始」を押し、マイク利用を許可する
5. 同じ画面の教材表示を見ながら AI 教師と音声会話する
6. ディクテーションや英作文は必要に応じて画面へ入力する
7. 授業終了後、得点・振り返り・次の課題を見る

### 3.2 授業画面の構成

| 領域 | 表示内容 | 目的 |
|---|---|---|
| 左 | 本文、語彙、文法ポイント | 教材を見ながら会話 |
| 中央 | AI音声状態、字幕、会話履歴 | 音声授業の中心 |
| 右 | 現在Step、課題、回答欄 | 何をしているか迷わせない |
| 下部 | マイク、停止、ヒント、終了 | 最低限の授業操作 |

> **重要**
> ChatGPT の画面を模倣することが目的ではない。学校授業に必要な
> 「教材と音声教師が同時に見える画面」を優先する。

---

## 4. WebアプリからOpenAI音声AIを呼び出す方法

### 4.1 基本方式：Realtime API＋WebRTC

ブラウザの音声対話は OpenAI Realtime API へ WebRTC で接続する。
OpenAI 公式資料では、ブラウザやモバイルのクライアントから Realtime モデルへ接続する場合、
WebSocket より WebRTC が推奨されている。

```
ブラウザ：マイク取得（getUserMedia）
   ↓
RTCPeerConnection / WebRTC
   ↓
OpenAI Realtime API（双方向音声）
```

### 4.2 APIキーの扱い

> **禁止**
> 通常の `OPENAI_API_KEY` を JavaScript やブラウザへ埋め込まない。
> 通常 API キーはサーバーの環境変数だけに置く。

接続開始時は、ブラウザ → 自分のサーバー → OpenAI という経路でセッションを初期化する。
OpenAI の現行仕様では (A) unified interface と (B) ephemeral client secret の2方式がある。

| 方式 | 概要 | v03判断 |
|---|---|---|
| Unified interface | ブラウザの SDP を自サーバーへ送り、サーバーが通常 API キーで Realtime session を作成 | **MVP主案**：経路が分かりやすく、ブラウザに OpenAI のクレデンシャルが一切渡らない |
| Ephemeral client secret | 自サーバーが短期キーを発行し、ブラウザがそのキーで Realtime へ直接接続 | 代替案：サーバー負荷を下げたい場合 |

接続手順の詳細は `docs/REALTIME_ARCHITECTURE.md`。

### 4.3 授業開始時の処理

1. 生徒認証を確認し、`student_id` と `class_id` を確定する
2. 今日の `material_id` と生徒のレベルを DB から取得する
3. 教材・到達目標・指導方法をサーバーで Realtime session 設定に変換する
4. ブラウザと Realtime API の WebRTC 接続を開始する
5. `lesson_sessions` を DB に作成し、授業開始時刻を記録する
6. AI 教師が Step 1 から授業を開始する

---

## 5. AI教師へ教材と授業ルールを渡す

### 5.1 Session instructionsの役割

AI に「教材全文」だけを渡して自由に教えさせるのではなく、教材データと授業手順を組み合わせた
session instructions を生成する。これが AI 教師の授業進行ルールとなる。

```
You are an English teacher for Japanese high-school students.

Today's material: {{material_json}}
Student level: {{level}}
Current step: {{step}}

Teaching rules:
1. Follow the 9-step lesson flow.
2. Ask one question at a time.
3. Do not immediately give the correct answer. Give a hint first.
4. Let the student create reasons in Japanese before translating them.
5. Never assign or state a score. Scoring is done by the application.
6. Call application tools to record answers and step completion.
```

**v03本文からの変更**：ルール5を「承認済みルーブリックのみ使用」から
「点数を与えない・述べない」に変更した。理由は §0.3 参照。

### 5.2 授業状態はAIの記憶だけに依存しない

- 現在の step、問題番号、再挑戦回数などはアプリ側でも保持する
- AI が話題を逸脱しても、アプリ側の `lesson_sessions` から復帰できるようにする
- 重要な結果は会話終了時にまとめてではなく、節目ごとに保存する

---

## 6. 学習結果をサーバーへ送る仕組み

### 6.1 Realtime function toolsは「記録」に使う

OpenAI Realtime はライブ会話中に function tools を呼び出せる。
ただし **WebRTC 構成では tool 呼び出しがブラウザのデータチャネルを通る**ため、
引数はすべて改ざん可能な値として扱う。

したがってセッション中の tool は **記録専用**とし、点数を引数に取らない。

| Function tool | 主な入力 | サーバー処理 |
|---|---|---|
| `record_answer` | session_id, item_id, answer_text | 生答案を保存（採点しない） |
| `record_argument` | session_id, side, ja_text, en_text | 日本語論拠と英語版を保存 |
| `mark_step_complete` | session_id, step_no | ステップ通過を記録 |
| `flag_difficulty` | session_id, topic, note | つまずきを記録 |
| `request_hint_used` | session_id, item_id | ヒント使用を記録 |

採点は **セッション終了後にサーバー側で実行**する。詳細は `docs/RUBRIC.md`。

### 6.2 学習結果のデータフロー

```
AI：「この段階の答案を記録する必要がある」
   ↓
Realtime が function call 引数を生成
   ↓（ブラウザのデータチャネル経由。値は信用しない）
ブラウザ → /api/results/answer
   ↓
サーバーが本人・session_id・item_id の整合性を検証
   ↓
PostgreSQL の session_answers へ保存
   ↓
function_call_output を Realtime へ返し、授業継続

--- セッション終了後 ---

書き起こし + session_answers
   ↓
ディクテーション：文字列照合（コード・確定）
英作文・論述：採点器モデル（テキスト）
Speaking / Interaction：採点器モデル（書き起こし）
   ↓
scoring_runs / scores へ保存
   ↓
教師が確認・必要なら修正（score_overrides + audit_logs）
```

> **安全設計**
> AI が `student_id` を自由入力して他人の成績を更新できないようにする。
> `student_id` と権限はログインセッション側で確定し、AI から渡された値を信用しない。

---

## 7. バックエンド構成

### 7.1 推奨スタック

| 層 | 推奨 | 役割 |
|---|---|---|
| フロント | Next.js + TypeScript | 生徒・教師・教材管理UI |
| 音声 | OpenAI Realtime API + WebRTC | リアルタイム音声教師 |
| サーバーAPI | Next.js Route Handlers | Realtime session、教材、保存、権限 |
| DB/Auth | Supabase (PostgreSQL + Auth) | ユーザー、教材、学習履歴、評価 |
| Storage | Supabase Storage 等 | 画像・音声等のファイル |
| Hosting | Vercel + Supabase | GitHub 連携・プレビュー環境 |
| 開発 | Claude Code on the web | 実装・テスト・修正 |
| 版管理 | GitHub | PR、履歴、ロールバック |

### 7.2 最小APIエンドポイント

`docs/API_SPEC.md` に完全な仕様。概要は以下。

| Method / Path | 用途 |
|---|---|
| `GET /api/lessons/today` | 今日の教材取得 |
| `POST /api/lesson-sessions` | lesson_session 開始 |
| `POST /api/realtime/session` | Realtime 接続初期化（SDP 中継） |
| `POST /api/results/answer` | 答案の記録（採点しない） |
| `POST /api/results/argument` | 論拠の記録 |
| `POST /api/results/step` | ステップ通過の記録 |
| `POST /api/lesson-sessions/:id/finish` | 授業終了・採点実行 |
| `GET /api/teacher/sessions` | 教師向け結果一覧 |

---

## 8. 学習履歴・成績データモデル

完全な定義は `docs/DATA_MODEL.md` および `supabase/migrations/0001_init.sql`。

| テーブル | 用途 |
|---|---|
| `students` | 生徒 |
| `lesson_sessions` | 1回の授業 |
| `session_answers` | 生答案（採点前・不変） |
| `session_steps` | ステップ通過記録 |
| `session_transcript` | 会話の書き起こし |
| `session_usage` | API 利用量（コスト算出用） |
| `scoring_runs` | 採点の実行記録（いつ・何で・どの基準で） |
| `scores` | 採点結果 |
| `score_overrides` | 教員修正 |
| `progress` | 継続到達度 |
| `audit_logs` | 変更履歴 |

### 8.1 共通ルーブリック

| 評価軸 | 内容 | 配点 | 採点方法 |
|---|---|---|---|
| Language Accuracy | 文法・語彙の正確さ | 20 | 一部確定 + モデル |
| Comprehension | 本文・相手発言の理解 | 15 | モデル |
| Speaking | 発音・流暢さ・聞き取りやすさ | 15 | モデル（MVP では記録のみ） |
| Claim | 立場の明確さ | 10 | モデル |
| Reasoning | 理由の具体性・論理性 | 20 | モデル |
| Interaction | 相手への応答 | 10 | モデル |
| Improvement | 授業内・前回からの改善 | 10 | モデル |

採点方法の3分類は `docs/RUBRIC.md`。

---

## 9. 教師用機能

- クラス・生徒一覧と進捗状況を確認する
- テーマ・レベル・期限を割り当てる
- 教材を登録・修正・版管理する
- AI 生成教材候補を承認／却下する
- AI 採点を確認し、必要な場合のみ修正する
- 修正前の AI 評価と修正後の教師評価を両方残す
- 学習データから「つまずきが大きい生徒」を抽出する

> **教師の役割**
> 30〜40人を同時に一斉説明する役割から、教材・評価基準を設計し、
> AI で解決しにくい生徒へ介入する役割へ比重を移す。

---

## 10. Claude Code on the webでの実装

### 10.1 位置づけ

Claude Code on the web は生徒が使う本番システムではない。
GitHub リポジトリを対象に、クラウド上の隔離環境でコードを読ませ、実装・テスト・修正を行う
開発環境として利用する。

```
基本設計書 / Markdown仕様
   ↓
GitHub Repository
   ↓
Claude Code on the web：実装・テスト・修正
   ↓
Pull Request / Review / CI
   ↓
Vercel / Supabase へデプロイ
```

### 10.2 基準ファイル

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | 実装方針・禁止事項・テスト条件 |
| `docs/BASIC_DESIGN_v03.md` | 本設計書 |
| `docs/LESSON_FLOW.md` | 9ステップ授業 |
| `docs/REALTIME_ARCHITECTURE.md` | WebRTC / Realtime session / function tools |
| `docs/DATA_MODEL.md` | DB テーブルと関係 |
| `docs/API_SPEC.md` | HTTP API 仕様 |
| `docs/RUBRIC.md` | 評価基準と採点方法 |
| `docs/SECURITY.md` | API キー、権限、未成年データの扱い |
| `docs/TASKS.md` | Claude Code へのタスク指示 |

---

## 11. リポジトリ構成

```
ai-english-debate/
├─ app/
│  ├─ student/              # 生徒画面
│  ├─ teacher/              # 教師画面
│  └─ api/
│     ├─ realtime/          # session初期化（APIキーを使う唯一の場所）
│     ├─ lessons/           # 教材API
│     └─ results/           # 学習結果保存
├─ components/
│  ├─ lesson/
│  ├─ voice/
│  └─ teacher/
├─ lib/
│  ├─ openai/               # Realtime接続設定・instructions生成
│  ├─ db/                   # DBアクセス
│  ├─ auth/
│  └─ scoring/              # 採点ロジック（純粋関数）
├─ supabase/
│  └─ migrations/
├─ content/                 # 初期教材JSON / seeds
├─ docs/
├─ tests/
├─ CLAUDE.md
└─ README.md
```

---

## 12. セキュリティ・個人情報・未成年利用

詳細は `docs/SECURITY.md`。

| 要件 | 方針 |
|---|---|
| OpenAI APIキー | サーバー環境変数のみ。GitHub・ブラウザへ出さない |
| 契約主体 | 検証段階は開発者個人。学校運用前に学校名義へ移行を検討 |
| 認証 | 学校アカウントまたは認証基盤で本人を確定 |
| 権限 | 生徒は自分のデータだけ。教師は担当クラスのみ |
| 音声保存 | 原則、全文音声を保存しない。書き起こしのみ保持 |
| 会話ログ | 成績に必要な範囲を保持し、保持期間を設定 |
| 成績変更 | AI 評価 → 教師修正の履歴を `audit_logs` へ残す |
| ツール実行 | DB 直接アクセスを AI へ与えず、用途限定 API 経由 |
| 信頼境界 | ブラウザ由来の値は改ざん可能として扱う |
| 未成年 | OpenAI の Under 18 API Guidance 等を確認し、学校運用ポリシーを別途策定 |

---

## 13. 非機能要件

| 分類 | 基本要件 |
|---|---|
| 同時利用 | まず1クラス30〜40名の同時利用を想定 |
| 音声遅延 | 会話感を損なわないことを最優先し、WebRTC で実機測定 |
| 再開性 | 接続切断時に `lesson_sessions` から授業を再開できる |
| 保存 | 節目ごとに結果保存し、終了時だけに依存しない |
| 端末 | Windows ＋ Edge/Chrome ＋ 有線または USB ヘッドセットを基準に検証 |
| Wi-Fi | 30〜40台の同時音声通信を校内環境で負荷試験 |
| コスト | API 利用時間・音声トークン量を session 単位で記録し、授業単価を算出 |
| 可観測性 | エラー、接続時間、API 利用量、保存失敗をログ化 |

---

## 14. MVP：最初に作るもの

> **MVPの定義**
> 「School Uniforms」初級1教材を、独自 Web 画面から開始し、OpenAI Realtime 音声で
> 基礎学習 → 日本語論拠 → 英語化 → 短いディベート → 成績保存まで完走できる。
> まず1レベルを通してから中級・上級へ増やす。

### 14.1 MVP必須機能

- 生徒ログイン（簡易で可）
- School Uniforms 初級教材を DB から取得
- 独自授業画面に教材を表示
- WebRTC で OpenAI Realtime 音声会話を開始
- 授業用 instructions を教材から生成
- 答案を function tool で記録
- 日本語論拠と英語論拠を記録
- 短い AI ディベート
- **セッション終了後のサーバー側採点**
- 教師画面で結果を1件確認

### 14.2 MVPでは後回し

- 精密な発音自動採点
- 大量教材自動生成
- 複雑な校務システム連携
- 保護者画面
- 多校展開・課金
- 高度な分析ダッシュボード
- ChatGPT Apps SDK を主フロントにする構成

---

## 15. 実装ロードマップ

| Step | 成果物 | 合格条件 |
|---|---|---|
| 1 | School Uniforms 初級教材 JSON | 9ステップの内容が確定 |
| 2 | DB / Auth | ログイン → 教材取得ができる |
| 3 | 授業画面 | 教材＋マイク UI が表示できる |
| 4 | Realtime PoC | WebRTC で音声往復できる |
| 5 | 教材注入 | AI が指定教材・手順に沿って授業する |
| 6 | 記録ツール | 答案が DB へ入る |
| 7 | 採点パイプライン | セッション終了後に採点が走る |
| 8 | 授業完走 | 論拠 → 英語化 → ディベート → 評価まで完了 |
| 9 | 中級・上級追加 | 3レベルで同じテーマを実施 |
| 10 | 教師画面 | クラス進捗と評価確認 |
| 11 | 30〜40人実証 | 音声・Wi-Fi・費用・操作性を測定 |

---

## 16. 具体的な1回の授業データフロー

1. 20:00 生徒 A がログインし、「School Uniforms / Beginner」を開始
2. サーバーが `student_id`・`material_id` を確認し `lesson_sessions` を作成
3. サーバーが教材 JSON と指導ルールから Realtime session 設定を作成
4. ブラウザが WebRTC 接続し、AI 教師が挨拶して Step 1 へ
5. ディクテーション終了時、AI が `record_answer` を呼び、生答案を DB へ保存
6. 生徒が日本語で理由を2つ作り、`record_argument` で原文と英語版を保存
7. AI が反対意見を出し、生徒が英語で応答
8. 終了時に `mark_step_complete(9)`。ブラウザが `/finish` を呼ぶ
9. **サーバーが書き起こしと答案から採点を実行**し、`scores` へ保存
10. 教師画面には「完了・得点・論拠・弱点」が表示される

---

## 17. 主なリスクと対策

| リスク | 対策 |
|---|---|
| Realtime API 仕様・モデル名の変更 | モデル名・接続設定を環境変数化し、アプリ層と教材層を分離 |
| AI が授業順序を飛ばす | アプリ側に step 状態を持ち、session instructions だけに依存しない |
| AI 採点のぶれ | 固定ルーブリック＋採点器モデルのバージョン固定＋教師修正 |
| **成績の改ざん** | **セッション中に点数を扱わない。採点はサーバー側のみ** |
| AI が答えを作りすぎる | ヒント → 部分修正 → 完成の支援順序を prompt に固定 |
| 音声切断 | 途中保存＋再接続後の `lesson_sessions` 再開 |
| API 利用費 | 授業時間・モデル・音声トークン量を計測し、上限設定 |
| 30〜40人同時利用 | 学校 Wi-Fi で負荷試験。開始時刻を数十秒ずらす案も比較 |
| 特定AIへの依存 | 音声層をアダプタとして分離し、採点層は別プロバイダでも動くようにする |
| Claude Code が設計を逸脱 | `CLAUDE.md` と本設計書を常時参照させ、PR 単位でレビュー |

---

## 18. 既存学校英語サービスとの位置づけ

学校現場ではオンライン英会話、AI 発音・スピーキング、語彙・文法定着、
デジタル教科書・総合学習プラットフォームを用途別に組み合わせる運用が中心。
本システムは、それらを単純に置き換えるのではなく、次の学習経路を一体化する点を中心価値とする。

> 基礎英語 → 内容理解 → 自分の意見 → 日本語論拠 → 英語化 → 発話 → 反論 → ディベート → 評価 → 次教材

---

## 参考資料・技術前提（2026年8月20日確認）

- OpenAI Developers, "Realtime API with WebRTC" — ブラウザ等のクライアントでは WebRTC を推奨。
  Unified interface / ephemeral client secret の接続方式を説明。
  https://developers.openai.com/api/docs/guides/realtime-webrtc
- OpenAI Developers, "Realtime" — GA インターフェースでは `POST /v1/realtime/client_secrets` で
  一時クレデンシャルを発行。`OpenAI-Safety-Identifier` の設定方法。
  https://developers.openai.com/api/docs/guides/realtime
- Anthropic, "Claude Code on the web" — クラウドの隔離環境で Git 操作を含む開発が可能。
  https://code.claude.com/docs/en/web-quickstart
- Anthropic, "Configure cloud environments" — ネットワークアクセスレベル、環境変数、セットアップスクリプト。
  https://code.claude.com/docs/en/cloud-environments

---

*― End of Basic Design v03 (Markdown版) ―*
