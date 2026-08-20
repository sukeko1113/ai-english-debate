# RUBRIC.md — 評価基準と採点方法

---

## 大原則

**音声セッション中に採点しない。** モデルに点数を言わせない、計算させない、渡させない。

採点はセッション終了後、サーバー側で `session_answers` と `session_transcript` から実行する。

理由：

1. セッション中の tool 呼び出しはブラウザを経由するので点数が改ざんできる
2. 音声プロバイダを変えると採点基準がずれる
3. ルーブリックを改善したとき、過去分を再採点できなくなる
4. 採点は遅くてよいので、会話用とは別の（安定した・安い・賢い）モデルを選べる

---

## 採点方法の3分類

| 分類 | 誰が採点 | いつ | 対象 |
|---|---|---|---|
| **確定採点** | コード（文字列照合） | セッション終了直後 | ディクテーション、選択問題、穴埋め |
| **モデル採点** | 採点器モデル | セッション終了後 | 英作文、論述、ルーブリック各軸 |
| **記録のみ** | 採点しない | — | MVP 段階の Speaking、つまずき記録 |

### 確定採点

`lib/scoring/deterministic.ts` に純粋関数として置く。**AI を使わない。**

```ts
export function scoreDictation(
  answer: string,
  expected: string,
): { correct: boolean; normalized: string }
```

正規化ルール（`lib/scoring/normalize.ts`）：

- 前後の空白を除去、連続空白を1つに
- 大文字小文字を無視
- 文末の `.` `!` `?` を無視
- `'` `'` `"` `"` を ASCII に統一
- カンマは無視しない（`because` の前のカンマ有無は文法事項なので）

同じ答案は必ず同じ結果になること。テストを必ず書く。

### モデル採点

`lib/scoring/model.ts`。採点器の設定は環境変数で固定する。

```
SCORER_MODEL=<モデル名>
SCORER_PROMPT_VERSION=v1
```

**学期の途中でモデルが勝手に変わらないよう、バージョンをピン留めする。**
変更するときは `scoring_runs` に新しいバージョンが記録されるので追跡できる。

採点器への入力：

```json
{
  "rubric_version": "v1",
  "material": { "...教材...": "..." },
  "level": "beginner",
  "answers": [ { "question_id": "...", "answer_text": "...", "attempt_no": 1 } ],
  "arguments": { "side": "agree", "ja_text": "...", "en_text": "..." },
  "transcript": [ { "speaker": "student", "text": "...", "started_at_ms": 12000 } ]
}
```

採点器の出力（JSON のみ。散文を返させない）：

```json
{
  "axes": [
    {
      "axis": "reasoning",
      "raw_score": 14,
      "max_score": 20,
      "evidence": ["理由を2つ述べているが、2つ目が1つ目の言い換えになっている"]
    }
  ]
}
```

`evidence` を必須にする。教員が修正を判断するとき、根拠がないと判断できない。

---

## ルーブリック v1

`rubrics` テーブルに投入する内容。合計 100 点。

| 軸 | key | 配点 | 採点方法 | 見るもの |
|---|---|---|---|---|
| Language Accuracy | `language_accuracy` | 20 | 確定10 + モデル10 | ディクテーション正答（確定）＋ 発話・英作文の文法語彙（モデル） |
| Comprehension | `comprehension` | 15 | モデル | 本文理解の質問への回答、相手の発言への理解 |
| Speaking | `speaking` | 15 | **MVP は記録のみ** | 発音・流暢さ。自動採点は Step 11 以降 |
| Claim | `claim` | 10 | モデル | 賛成／反対の立場が明確に述べられているか |
| Reasoning | `reasoning` | 20 | モデル | 理由が具体的か、2つが独立しているか |
| Interaction | `interaction` | 10 | モデル | 反論に対して応答できているか（黙り込んでいないか） |
| Improvement | `improvement` | 10 | モデル | 同一授業内で言い直しが改善されたか |

### MVP での扱い

**Speaking は MVP では採点しない。** 理由は2つ。

- リアルタイム音声モデルは客観的な発音採点が得意ではない
- 発音の自動採点は v03 §14.2 で後回しと決めている

MVP では Speaking を「記録のみ」とし、教員が必要なら手動で入れる。
合計点は `100 - 15 = 85` を満点として扱うか、Speaking を教員入力必須にするかを
実装前に確認すること。**勝手に決めない。**

### レベル別の扱い

**配点は3レベル共通。基準記述（descriptors）だけをレベル別にする。**
これが v03 §1.3 の「教材難易度は変えても評価軸は共有する」の実装。

例：Reasoning 20点

| レベル | 満点の条件 |
|---|---|
| beginner | 独立した理由を2つ、`because` を使って述べられる |
| intermediate | 理由を具体例で補強し、簡単な反論に応答できる |
| advanced | 複数根拠を比較し、反論に再反論できる |

---

## 採点の実行タイミング

```
POST /api/lesson-sessions/:id/finish
   ↓
status = 'scoring' に更新
   ↓
1. 確定採点（同期。速い）
   ↓
2. モデル採点（非同期でよい）
   ↓
3. scoring_runs + scores を書き込み、is_current = true
   ↓
status = 'finished'
```

モデル採点が失敗しても、確定採点の結果は残ること。
生徒には「採点中」を表示し、完了後に得点が出る形でよい。

---

## 教員修正

```
scores（AI採点）  →  score_overrides（教員修正）  →  最終成績
```

- 元の `scores` は書き換えない
- `score_overrides` には `reason` を必須にする
- 修正は `audit_logs` にも記録する

v03 §9 は「必要な場合のみ修正」だが、**成績に乗せる運用に入る前に、
教員が全件確認するかどうかを決める必要がある。** 実装は両方に対応できるようにする。

---

## 再採点

```
POST /api/admin/rescoring
  { sessionIds: [...], rubricVersion: "v2", scorerModel: "..." }
```

- 新しい `scoring_runs` を作る
- 古い run の `is_current` を false にする
- `score_overrides` は引き継がない（新しい採点に対して改めて判断してもらう）

管理者のみ実行可能。

---

## 実装前に測っておくこと

**採点のばらつきを実測する。** これをやらずに成績に乗せない。

1. School Uniforms 初級の英作文の答案を20本用意する（架空でよい）
2. 各答案を採点器で3回採点する
3. 同一答案の点数の分散を見る

分散が大きい場合の対処：

- 採点を段階的な設問に分解する（「`because` が使えているか」「主語動詞が一致しているか」）
- 各設問を yes/no にして、合計を点数にする
- それでも安定しなければ、その軸は教員手動にする

このテストは `tests/scoring/variance.test.ts` として残す。
