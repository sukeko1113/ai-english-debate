-- 0004_realtime_calls.sql — Realtime 接続の記録とレート制限
--
-- /api/realtime/session は OPENAI_API_KEY を使うため課金に直結する。
-- 認証済みでも無制限に叩けてはいけない（docs/SECURITY.md §6 /
-- docs/API_SPEC.md「実装上の注意」）。
--
-- 接続のたびに1行入れ、直近1時間の件数で上限を判定する。
-- call_id は OpenAI が Location ヘッダで返す ID。
-- 利用量（session_usage）との突き合わせに使う。

create table realtime_calls (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references lesson_sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  call_id    text,
  model      text not null,
  created_at timestamptz not null default now()
);

create index on realtime_calls (student_id, created_at desc);
create index on realtime_calls (session_id);
