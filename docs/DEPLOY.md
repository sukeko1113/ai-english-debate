# DEPLOY.md — Vercel + Supabase へ公開する

感想をもらうために、限られた人へ公開する手順。
**大人のみ・メールの許可リスト方式**で運用する前提
（docs/SECURITY.md §3「誰でもサインアップできる状態にしない」）。

高校生に使ってもらう段階へ進むときは、先に `docs/SECURITY.md` §4 の
チェックリスト（学校ポリシー確認・保護者への説明と同意・保持期間）が要る。

---

## 1. Supabase（データベース）

1. <https://supabase.com> でプロジェクトを作る
2. **リージョンは東京（Northeast Asia / Tokyo）を選ぶ。あとから変更できない**
   （docs/SECURITY.md §4）
3. Project Settings → Database → Connection string → **URI** を控える

スキーマと教材を入れる。**手元から実行する。**

```bash
DATABASE_URL="（控えた接続文字列）" npm run db:apply
DATABASE_URL="（控えた接続文字列）" npm run seed:content
```

`db:apply` は接続先がローカルでないと判断すると `auth` シムを自動で飛ばす
（Supabase には `auth` スキーマが既にあるため）。

---

## 2. Google のログイン設定

1. <https://console.cloud.google.com> でプロジェクトを作る
2. 「APIとサービス」→「OAuth 同意画面」を設定（外部／テスト でよい）
3. 「認証情報」→ OAuth クライアント ID を作る。種類は **ウェブアプリケーション**
4. **承認済みのリダイレクト URI** に次を入れる

```
https://（Vercelのドメイン）/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

クライアント ID とシークレットを控える。

---

## 3. Vercel（アプリ）

1. <https://vercel.com> でこのリポジトリを Import する
2. Environment Variables に次を入れる

| 変数 | 値 |
|---|---|
| `OPENAI_API_KEY` | OpenAI のキー |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` |
| `SAFETY_ID_SALT` | `openssl rand -hex 32` の出力 |
| `DATABASE_URL` | Supabase の接続文字列 |
| `ALLOWED_EMAILS` | 入れてよい人のメール（カンマ区切り） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 手順2で控えたもの |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` の出力 |
| `NEXTAUTH_URL` | `https://（Vercelのドメイン）` |
| `REALTIME_VAD_EAGERNESS` | 任意。既定は `high` |

3. Deploy する

---

## 4. 公開前に必ず確認すること

- [ ] **`ALLOWED_EMAILS` が入っているか。** 空だと誰も入れない（安全側に倒してある）
- [ ] 許可していないアカウントでログインを試し、**弾かれること**
- [ ] OpenAI の**月額ハードリミット**を設定したか（docs/SECURITY.md §1）
- [ ] `REALTIME_SESSIONS_PER_HOUR`（既定6）で1人あたりの上限がかかること

### 費用について

**入れた人数 × 1時間あたり6セッション**まで API を使える。
人数を増やすときは、OpenAI 側の上限額を先に決めること。

---

## 5. 使ってもらう人へ伝えること

ログイン画面にも出るが、口頭でも伝えるとよい。

- **会話の書き起こしが保存される**（音声そのものは保存しない）
- 答えは日本語でよい
- 授業中に点数は出ない
- 30〜40分かかる。途中でやめても続きから戻れる

---

## 6. まだ決めていないこと

- **書き起こしの保持期間と削除手順**（docs/SECURITY.md §4）。
  感想集めが終わったら消すのか、残すのかを決める
- 教師画面が無いので、結果は DB を直接見る

```bash
psql "$DATABASE_URL" -c "select speaker, text from session_transcript order by seq"
```
