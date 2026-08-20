# API_SPEC.md — HTTP API 仕様

すべてのエンドポイントで共通のルール：

- 認証必須。未認証は `401`
- `student_id` はリクエストボディから受け取らない。**認証セッションから引く**
- `lessonSessionId` は必ず所有者を検証する。他人のものなら `404`（`403` ではない。存在を漏らさない）
- エラーレスポンスに内部情報を含めない
- すべてのレスポンスは JSON（`/api/realtime/session` を除く）

---

## 生徒向け

### `GET /api/lessons/today`

今日割り当てられている教材を返す。

**レスポンス**
```json
{
  "materialId": "uuid",
  "topic":  { "titleEn": "School Uniforms", "titleJa": "学校の制服" },
  "level": "beginner",
  "objectives": ["becauseで理由を言う", "理由を2つ述べる"],
  "script": "School uniforms are common in many schools...",
  "vocabulary": [ { "word": "uniform", "meaning": "制服", "example": "..." } ],
  "grammarPoints": [ { "point": "because", "explanation": "...", "examples": ["..."] } ],
  "questions": [
    { "id": "uuid", "type": "dictation", "prompt": "...", "maxScore": 1 }
  ],
  "existingSessionId": "uuid | null"
}
```

- `questions` に **`answer` を含めない。** ブラウザに正解を送らない
- `existingSessionId` があれば「続きから」を表示する

### `POST /api/lesson-sessions`

授業を開始する。

**リクエスト**
```json
{ "materialId": "uuid" }
```

**レスポンス**
```json
{ "lessonSessionId": "uuid", "currentStep": 1, "rubricVersion": "v1" }
```

- 未完了の同一教材セッションがあれば、新規作成せずそれを返す
- `rubric_version` と `prompt_version` をここで固定する

### `POST /api/realtime/session`

WebRTC の SDP を中継する。**`OPENAI_API_KEY` を使う唯一の場所。**

**リクエスト**
- `Content-Type: application/json`
```json
{ "lessonSessionId": "uuid", "sdp": "v=0\r\no=- ..." }
```

**レスポンス**
- `Content-Type: application/sdp`
- SDP answer をそのまま返す

**サーバー処理**
1. 認証確認
2. `lessonSessionId` の所有者検証
3. 教材を DB から取得
4. `current_step` の instructions を生成
5. `OpenAI-Safety-Identifier` を付けて OpenAI へ POST
6. SDP answer を返す

**エラー**
- OpenAI 側のエラーメッセージをそのままクライアントへ返さない。`502` と汎用メッセージ

### `POST /api/results/answer`

答案を記録する。**採点しない。**

**リクエスト**
```json
{
  "lessonSessionId": "uuid",
  "args": { "item_id": "uuid", "answer_text": "...", "attempt_no": 1 }
}
```

**サーバー処理**
1. 所有者検証
2. `item_id` が **このセッションの教材に属する** `questions.id` であることを検証
3. `session_answers` に INSERT（`ON CONFLICT DO NOTHING`）

**レスポンス**
```json
{ "ok": true }
```

**正誤や点数を返さない。** 返すとモデルがそれを口に出す。

### `POST /api/results/argument`

論拠を記録する。

**リクエスト**
```json
{
  "lessonSessionId": "uuid",
  "args": { "side": "agree", "ja_text": "朝が楽", "en_text": "" }
}
```

- `en_text` が空でも受け付ける（Step 5 では日本語だけ）
- Step 6 で同じ論拠に `en_text` を追記する場合は UPDATE
- **`ja_text` を上書きしない。** 日本語原文は保存し続ける

### `POST /api/results/step`

ステップ通過を記録する。

**リクエスト**
```json
{ "lessonSessionId": "uuid", "args": { "step_no": 3 } }
```

**レスポンス（正常）**
```json
{ "ok": true, "nextStep": 4, "instructions": "..." }
```

**レスポンス（step が食い違う）**
```json
{ "ok": false, "currentStep": 3 }
```

`current_step` を進めない。警告ログを出す。

### `POST /api/results/difficulty`

つまずきを記録する。

```json
{ "lessonSessionId": "uuid", "args": { "topic": "because", "note": "語順が定着していない" } }
```

### `POST /api/results/transcript`

書き起こしを逐次保存する。バッチで送ってよい。

```json
{
  "lessonSessionId": "uuid",
  "items": [
    { "seq": 1, "speaker": "tutor", "text": "Hello!", "startedAtMs": 1200 }
  ]
}
```

### `POST /api/results/usage`

利用量を記録する。Realtime の usage イベントから。

```json
{
  "lessonSessionId": "uuid",
  "model": "...",
  "audioInputTokens": 12000,
  "audioOutputTokens": 34000,
  "textInputTokens": 800,
  "textOutputTokens": 400
}
```

### `POST /api/lesson-sessions/:id/finish`

授業を終了し、採点を開始する。

**レスポンス**
```json
{ "ok": true, "status": "scoring" }
```

**サーバー処理**
1. 所有者検証
2. `status = 'scoring'`、`finished_at` を記録
3. 確定採点を同期実行
4. モデル採点を開始（非同期でよい）
5. `scoring_runs` と `scores` を書き込む
6. `status = 'finished'`

**このエンドポイントだけが `scores` を書き込む権限を持つ。**

### `GET /api/lesson-sessions/:id/result`

採点結果を取得する。

```json
{
  "status": "finished",
  "totalScore": 72,
  "maxScore": 85,
  "axes": [ { "axis": "reasoning", "score": 14, "max": 20 } ],
  "feedback": { "goodPoints": ["..."], "nextGoal": "..." }
}
```

`status: "scoring"` の場合は点数を含めず、「採点中」を返す。

---

## 教師向け

すべて教師ロール必須。**担当クラスの範囲に限定する。**

### `GET /api/teacher/sessions?classId=&from=&to=`

授業結果の一覧。

### `GET /api/teacher/sessions/:id`

1回の授業の詳細。答案、論拠、書き起こし、採点、根拠を含む。

### `POST /api/teacher/scores/:scoringRunId/override`

採点を修正する。

```json
{ "axis": "reasoning", "newScore": 16, "reason": "2つ目の理由は独立していると判断" }
```

- `reason` 必須
- `score_overrides` へ INSERT。`scores` は書き換えない
- `audit_logs` にも記録

---

## 管理者向け

### `POST /api/admin/rescoring`

再採点。

```json
{ "sessionIds": ["uuid"], "rubricVersion": "v2", "scorerModel": "..." }
```

---

## 実装上の注意

**レート制限を入れる。** 特に `/api/realtime/session`。
無制限だと、認証済みユーザーがセッションを大量生成して OpenAI の課金を消費できる。

- 生徒あたり 1時間に N セッションまで
- 同時アクティブセッションは1つまで

**`OPENAI_API_KEY` の使用箇所を1ファイルに限定する。**
`lib/openai/client.ts` からのみ読み、他の場所で `process.env.OPENAI_API_KEY` を参照しない。
これを lint ルールまたはテストで強制する。
