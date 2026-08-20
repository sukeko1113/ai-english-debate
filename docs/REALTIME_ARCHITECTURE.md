# REALTIME_ARCHITECTURE.md — 音声接続とfunction tools

対象：`app/api/realtime/`、`lib/openai/`、`components/voice/`

---

## 1. 信頼境界 — 最初に読むこと

```
┌─────────────────────────────────────────┐
│ 信頼できない領域（生徒のブラウザ）              │
│                                          │
│  ・WebRTC 音声ストリーム                    │
│  ・データチャネル（function call が通る）      │
│  ・画面入力欄                               │
│                                          │
│  → ここを通った値はすべて改ざん可能            │
└─────────────────────────────────────────┘
                    ↓ HTTPS + 認証Cookie
┌─────────────────────────────────────────┐
│ 信頼できる領域（サーバー）                     │
│                                          │
│  ・OPENAI_API_KEY                        │
│  ・student_id の決定                       │
│  ・採点                                    │
│  ・DB 書き込み                              │
└─────────────────────────────────────────┘
```

**WebRTC 構成では、モデルの function call はブラウザのデータチャネルに届く。**
ブラウザ側の JavaScript がそれを受け取り、サーバー API を呼び、結果をモデルへ返す。

つまり生徒は開発者ツールで、

- function call の引数を書き換えられる
- 呼ばれていない tool を呼んだことにできる
- サーバー API を直接叩ける

したがって **サーバー API は「モデルから来た」という前提を一切置かない。**
通常の Web フォーム送信と同じ厳しさで検証する。

### 導かれる設計

| やること | やらないこと |
|---|---|
| tool は記録専用にする | tool の引数に点数を含める |
| 採点はサーバー側で書き起こしから行う | モデルに点数を計算させる |
| `student_id` は認証セッションから引く | tool 引数の `student_id` を使う |
| `item_id` が session の教材に属することを検証 | 渡された `item_id` をそのまま保存 |
| `session_id` の所有者を検証 | `session_id` を信用する |

---

## 2. 接続方式：Unified interface

MVP は unified interface を使う。サーバーが SDP を中継するため、
**ブラウザには OpenAI のクレデンシャルが一切渡らない。**

### シーケンス

```
ブラウザ                     自サーバー                  OpenAI
   │                            │                        │
   │ 1. getUserMedia()          │                        │
   │    RTCPeerConnection 作成   │                        │
   │    createOffer()           │                        │
   │                            │                        │
   │ 2. POST /api/realtime/session                       │
   │    { lessonSessionId, sdp } │                        │
   │───────────────────────────>│                        │
   │                            │ 3. 認証確認             │
   │                            │    session 所有者検証    │
   │                            │    教材をDBから取得       │
   │                            │    instructions 生成     │
   │                            │                        │
   │                            │ 4. SDP + session設定    │
   │                            │    Authorization: Bearer sk-...
   │                            │    OpenAI-Safety-Identifier: <hash>
   │                            │───────────────────────>│
   │                            │                        │
   │                            │ 5. SDP answer          │
   │                            │<───────────────────────│
   │ 6. SDP answer              │                        │
   │<───────────────────────────│                        │
   │                            │                        │
   │ 7. setRemoteDescription()  │                        │
   │    音声・データチャネル確立 ←───────────────────────>│
```

### サーバー側の実装ポイント

```ts
// app/api/realtime/session/route.ts （骨子）
export async function POST(req: Request) {
  const user = await requireStudent();              // 認証。失敗なら401
  const { lessonSessionId, sdp } = await req.json();

  const session = await db.lessonSessions.findOwned(lessonSessionId, user.id);
  if (!session) return new Response('Not found', { status: 404 });

  const material = await db.materials.get(session.materialId);
  const instructions = buildInstructions(material, session);

  const res = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/sdp',
      'OpenAI-Safety-Identifier': safetyIdFor(user.id),   // 生IDではなくハッシュ
    },
    body: sdp,
    // session 設定（model / voice / instructions / tools / turn_detection）は
    // クエリまたは同時送信。実装時に最新ドキュメントで確認すること。
  });

  return new Response(await res.text(), {
    headers: { 'Content-Type': 'application/sdp' },
  });
}
```

> **実装時の注意**
> Realtime API のエンドポイントとパラメータの渡し方は変更が続いている。
> 実装前に必ず https://developers.openai.com/api/docs/guides/realtime-webrtc を確認し、
> ベータ版の `/realtime/sessions` ではなく GA のエンドポイントを使うこと。
> 参照した日付とエンドポイントを PR 本文に記載する。

### Safety Identifier

- 生徒ごとに安定した値を渡す
- **生の学籍番号や氏名は渡さない。** `sha256(student_id + SAFETY_ID_SALT)` を使う
- `lib/openai/safety-id.ts` に集約する
- 後から追加すると過去セッションと紐づかないので、**初回実装に必ず含める**

---

## 3. Session instructions の生成

`lib/openai/instructions.ts` に純粋関数として置く。教材 JSON と現在の step を受け取り、
文字列を返す。**教材の中身をコードに書かない。**

```ts
export function buildInstructions(
  material: Material,
  session: LessonSession,
): string
```

### テンプレート

```
You are an English teacher for Japanese high-school students.
Speak English slowly and clearly. Use Japanese only when the student is stuck.

## Today's material
{{material_json}}

## Student level
{{level}}

## Current step
{{step_no}}: {{step_name}}
{{step_instruction}}

## Teaching rules
1. Follow the lesson steps in order. Do not skip a step.
2. Ask one question at a time. Wait for the student to answer.
3. Do not give the correct answer immediately. Give a hint first, then a partial
   correction, then the full answer only if the student is still stuck.
4. Let the student create their reasons in Japanese first, then help translate.
5. NEVER assign, state, or imply a score or grade. The application handles scoring.
6. Call `record_answer` immediately after the student gives an answer to a
   dictation or writing task. Record what they actually said, not a corrected version.
7. Call `mark_step_complete` when the current step's completion condition is met.
8. If the student goes off topic, bring them back to the current step.
```

### ステップごとの指示

全 9 ステップ分の指示をひとつの長い prompt に入れない。
**現在の step の指示だけを入れる。** ステップが進んだら `session.update` で差し替える。

理由：

- 長い prompt は指示の効きが落ちる
- 音声プロバイダを変えるとき、差し替え単位が小さいほど移植しやすい
- step の境界がアプリ側で管理されていることが明確になる

各ステップの指示文は `docs/LESSON_FLOW.md` に定義。

---

## 4. Function tools

### 定義

`lib/openai/tools.ts` に配置。**点数を引数に持つ tool を追加しないこと。**

```ts
export const LESSON_TOOLS = [
  {
    type: 'function',
    name: 'record_answer',
    description:
      'Record the student answer to a dictation or writing item. ' +
      'Record verbatim what the student said. Do not correct it. Do not score it.',
    parameters: {
      type: 'object',
      properties: {
        item_id:     { type: 'string', description: 'The question id from the material' },
        answer_text: { type: 'string', description: 'Verbatim student answer' },
        attempt_no:  { type: 'integer', description: '1 for first attempt' },
      },
      required: ['item_id', 'answer_text', 'attempt_no'],
    },
  },
  {
    type: 'function',
    name: 'record_argument',
    description: 'Record the student reasons. Save the Japanese original before translation.',
    parameters: {
      type: 'object',
      properties: {
        side:    { type: 'string', enum: ['agree', 'disagree'] },
        ja_text: { type: 'string' },
        en_text: { type: 'string', description: 'Empty string if not translated yet' },
      },
      required: ['side', 'ja_text'],
    },
  },
  {
    type: 'function',
    name: 'mark_step_complete',
    description: 'Call when the current step completion condition is satisfied.',
    parameters: {
      type: 'object',
      properties: { step_no: { type: 'integer' } },
      required: ['step_no'],
    },
  },
  {
    type: 'function',
    name: 'flag_difficulty',
    description: 'Record that the student struggled with something.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        note:  { type: 'string' },
      },
      required: ['topic'],
    },
  },
] as const;
```

**`session_id` を引数に含めない。** サーバー側で認証セッションと紐づける。
モデルに渡す必要がなく、渡せば改ざん対象が増えるだけ。

### ブラウザ側の処理

```ts
// components/voice/useRealtimeSession.ts （骨子）
dataChannel.addEventListener('message', async (e) => {
  const evt = JSON.parse(e.data);
  if (evt.type !== 'response.function_call_arguments.done') return;

  const result = await fetch(`/api/results/${routeFor(evt.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lessonSessionId,                       // クライアント保持。サーバーで所有者検証
      args: JSON.parse(evt.arguments),
    }),
  }).then(r => r.json());

  dataChannel.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: evt.call_id,
      output: JSON.stringify(result),        // { ok: true } 程度。点数を返さない
    },
  }));
  dataChannel.send(JSON.stringify({ type: 'response.create' }));
});
```

`function_call_output` に点数や正誤を含めない。含めるとモデルがそれを口に出す。

---

## 5. ステップ状態はアプリが持つ

`lesson_sessions.current_step` が正。モデルの認識はあくまで参考。

```
mark_step_complete(n) を受信
   ↓
サーバー: current_step が n であることを確認
   ↓  （違えば警告ログ。current_step は動かさない）
current_step = n + 1 に更新
   ↓
ブラウザへ「次のステップへ」を返す
   ↓
ブラウザが session.update で次の step の instructions を送る
```

モデルが順序を飛ばそうとしても、アプリ側の step は進まない。

---

## 6. 書き起こしの保存

採点はセッション終了後に書き起こしから行うので、**書き起こしは必ず保存する。**

- Realtime は入力・出力ともに transcript イベントを出す
- 受け取った transcript をブラウザから `/api/results/transcript` へ逐次送る
- 音声そのものは保存しない（`docs/SECURITY.md` 参照）

> 書き起こしもブラウザ経由なので改ざんされうる。
> 完全な防止は WebSocket でサーバー中継する構成が必要になるが、
> MVP ではその複雑さを取らない。代わりに、
> 「答案の記録」と「書き起こし」の矛盾を検出したらフラグを立てる。

---

## 7. 再接続

接続が切れても授業を続けられること。

- `lesson_sessions` に `current_step`、`status` を保持
- 再接続時は同じ `lessonSessionId` で `/api/realtime/session` を呼び直す
- instructions は現在の step のものから再生成する
- 既に記録済みの答案は再記録しない（`item_id` + `attempt_no` で一意制約）

---

## 8. 利用量とコストの記録

session ごとに以下を `session_usage` に記録する。Step 11 の実証で使う数字になる。

| 項目 | 取得元 |
|---|---|
| `audio_input_tokens` | Realtime の usage イベント |
| `audio_output_tokens` | 同上 |
| `text_input_tokens` / `text_output_tokens` | 同上 |
| `connected_seconds` | サーバー側で計測 |
| `model` | 使用したモデル名 |

**モデル名は `OPENAI_REALTIME_MODEL` 環境変数から読む。** コードに直書きしない。
mini 系との比較を実測できるようにするため。

---

## 9. turn detection の調整

日本語話者の英語発話は、言い直し・長い沈黙・小さい声が多い。
デフォルトの VAD 設定では途中で割り込まれる。

- `turn_detection` のパラメータを環境変数または設定ファイルで調整可能にする
- 実機テストで調整する前提でコードを書く（定数を直書きしない）
- 「AIが待ってくれない」「AIが喋り出さない」は最頻出の不具合として想定しておく
