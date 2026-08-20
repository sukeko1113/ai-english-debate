-- 0001_init.sql — 初期スキーマ
-- 設計意図は docs/DATA_MODEL.md を参照。
--
-- 重要な原則:
--   1. session_answers は採点結果を持たない（答案と採点の分離）
--   2. scores は scoring_runs に紐づく（再採点で行が増える）
--   3. score_overrides は scores を書き換えない（教員修正は別テーブルに積む）
--   4. テーブル定義本体は標準SQL。Supabase 固有の記法は RLS ポリシー内に閉じる

create extension if not exists "pgcrypto";

-- ============================================================
-- 組織・ユーザー
-- ============================================================

create table classes (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  school_code  text,
  created_at   timestamptz not null default now()
);

create table students (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique,                 -- 認証基盤のユーザーID
  class_id       uuid references classes(id),
  display_name   text not null,               -- 表示名のみ。学籍番号は別管理
  current_level  text not null default 'beginner'
                 check (current_level in ('beginner','intermediate','advanced')),
  created_at     timestamptz not null default now()
);

create table teachers (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

create table teacher_classes (
  teacher_id  uuid not null references teachers(id) on delete cascade,
  class_id    uuid not null references classes(id) on delete cascade,
  primary key (teacher_id, class_id)
);

-- ============================================================
-- 教材
-- ============================================================

create table topics (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  title_en   text not null,
  title_ja   text not null,
  category   text,
  status     text not null default 'draft' check (status in ('draft','approved','archived')),
  created_at timestamptz not null default now()
);

create table materials (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references topics(id) on delete cascade,
  level       text not null check (level in ('beginner','intermediate','advanced')),
  version     text not null,
  script      text not null,
  objectives  jsonb not null default '[]'::jsonb,
  status      text not null default 'draft' check (status in ('draft','approved','archived')),
  created_at  timestamptz not null default now(),
  unique (topic_id, level, version)
);

create table vocabulary (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  ord         int not null,
  word        text not null,
  meaning     text not null,
  example     text
);

create table grammar_points (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  ord         int not null,
  point       text not null,
  explanation text not null,
  examples    jsonb not null default '[]'::jsonb
);

-- answer はブラウザへ送らない（docs/API_SPEC.md 参照）
create table questions (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  key         text not null,
  ord         int not null,
  type        text not null check (type in ('dictation','comprehension','writing','vocabulary')),
  prompt      text not null,
  answer      text,
  answer_note text,
  max_score   numeric not null default 1,
  unique (material_id, key)
);

create table debate_tasks (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references topics(id) on delete cascade,
  level       text not null check (level in ('beginner','intermediate','advanced')),
  side        text not null check (side in ('for','against')),
  prompt      text not null,
  constraints jsonb not null default '{}'::jsonb
);

create table rubrics (
  id          uuid primary key default gen_random_uuid(),
  version     text not null,
  axis        text not null,
  level       text not null check (level in ('beginner','intermediate','advanced')),
  max_score   numeric not null,
  scorer_kind text not null check (scorer_kind in ('deterministic','model','record_only','teacher')),
  descriptors jsonb not null default '{}'::jsonb,
  unique (version, axis, level)
);

create table lesson_prompts (
  id                 uuid primary key default gen_random_uuid(),
  material_id        uuid references materials(id) on delete cascade,
  version            text not null,
  step_no            int,
  system_instruction text not null,
  unique (material_id, version, step_no)
);

-- ============================================================
-- 授業セッション（授業中に書き込まれる。すべて不変）
-- ============================================================

create table lesson_sessions (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id) on delete cascade,
  material_id    uuid not null references materials(id),
  rubric_version text not null,               -- 開始時に固定
  prompt_version text not null,               -- 開始時に固定
  current_step   int  not null default 1 check (current_step between 1 and 9),
  status         text not null default 'in_progress'
                 check (status in ('in_progress','scoring','finished','abandoned')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index on lesson_sessions (student_id, started_at desc);
create index on lesson_sessions (status);

-- 生答案。score カラムを持たない（原則1）
create table session_answers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references lesson_sessions(id) on delete cascade,
  question_id uuid not null references questions(id),
  attempt_no  int  not null default 1,
  answer_text text not null,                  -- 生徒が言った・書いたそのまま
  hint_used   boolean not null default false,
  recorded_at timestamptz not null default now(),
  unique (session_id, question_id, attempt_no)
);

create table session_arguments (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references lesson_sessions(id) on delete cascade,
  ord            int not null,
  side           text not null check (side in ('agree','disagree')),
  ja_text        text not null,               -- 日本語原文。上書きしない
  en_text        text,
  revision_count int not null default 0,
  recorded_at    timestamptz not null default now(),
  unique (session_id, ord)
);

create table session_steps (
  session_id   uuid not null references lesson_sessions(id) on delete cascade,
  step_no      int  not null check (step_no between 1 and 9),
  completed_at timestamptz not null default now(),
  primary key (session_id, step_no)
);

create table session_transcript (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references lesson_sessions(id) on delete cascade,
  seq           int  not null,
  speaker       text not null check (speaker in ('student','tutor')),
  text          text not null,
  started_at_ms int  not null,
  unique (session_id, seq)
);

create table session_difficulties (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references lesson_sessions(id) on delete cascade,
  topic       text not null,
  note        text,
  recorded_at timestamptz not null default now()
);

-- コスト算出用（docs/REALTIME_ARCHITECTURE.md §8）
create table session_usage (
  session_id          uuid primary key references lesson_sessions(id) on delete cascade,
  model               text not null,
  audio_input_tokens  bigint not null default 0,
  audio_output_tokens bigint not null default 0,
  text_input_tokens   bigint not null default 0,
  text_output_tokens  bigint not null default 0,
  connected_seconds   int    not null default 0,
  estimated_cost_usd  numeric(10,4),
  updated_at          timestamptz not null default now()
);

-- ============================================================
-- 採点（セッション終了後。サーバーのみが書き込む）
-- ============================================================

create table scoring_runs (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references lesson_sessions(id) on delete cascade,
  rubric_version    text not null,
  scorer_kind       text not null check (scorer_kind in ('deterministic','model','teacher')),
  scorer_model      text,
  scorer_prompt_ver text,
  is_current        boolean not null default true,
  run_at            timestamptz not null default now()
);

create index on scoring_runs (session_id, is_current);

create table scores (
  id             uuid primary key default gen_random_uuid(),
  scoring_run_id uuid not null references scoring_runs(id) on delete cascade,
  axis           text not null,
  raw_score      numeric not null,
  max_score      numeric not null,
  evidence       jsonb not null default '[]'::jsonb,   -- 教員が判断できる根拠
  unique (scoring_run_id, axis)
);

-- 元の scores を書き換えず、修正は積む（原則3）
create table score_overrides (
  id             uuid primary key default gen_random_uuid(),
  scoring_run_id uuid not null references scoring_runs(id) on delete cascade,
  axis           text not null,
  teacher_id     uuid not null references teachers(id),
  new_score      numeric not null,
  reason         text not null,                        -- 必須
  created_at     timestamptz not null default now()
);

create table progress (
  student_id uuid not null references students(id) on delete cascade,
  skill      text not null,
  level      text not null,
  score      numeric,
  updated_at timestamptz not null default now(),
  primary key (student_id, skill)
);

-- 追記のみ。UPDATE / DELETE を許可しない
create table audit_logs (
  id         bigserial primary key,
  actor_id   uuid,
  actor_role text not null,
  action     text not null,
  target     text not null,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

create index on audit_logs (target, created_at desc);

-- ============================================================
-- RLS
-- 二重防御の片方。API 層でも必ず所有者検証を行うこと（docs/SECURITY.md §3）
-- ============================================================

alter table lesson_sessions      enable row level security;
alter table session_answers      enable row level security;
alter table session_arguments    enable row level security;
alter table session_steps        enable row level security;
alter table session_transcript   enable row level security;
alter table session_difficulties enable row level security;
alter table scores               enable row level security;
alter table scoring_runs         enable row level security;

-- 生徒は自分のセッションのみ
create policy student_own_sessions on lesson_sessions
  for all
  using  (student_id in (select id from students where auth_user_id = auth.uid()))
  with check (student_id in (select id from students where auth_user_id = auth.uid()));

create policy student_own_answers on session_answers
  for all
  using (session_id in (
    select ls.id from lesson_sessions ls
    join students s on s.id = ls.student_id
    where s.auth_user_id = auth.uid()
  ));

-- 生徒は採点結果を「読む」だけ。書き込みは service role のみ
create policy student_read_scores on scores
  for select
  using (scoring_run_id in (
    select sr.id from scoring_runs sr
    join lesson_sessions ls on ls.id = sr.session_id
    join students s on s.id = ls.student_id
    where s.auth_user_id = auth.uid()
  ));

-- 教師は担当クラスの範囲のみ
create policy teacher_class_sessions on lesson_sessions
  for select
  using (student_id in (
    select s.id from students s
    join teacher_classes tc on tc.class_id = s.class_id
    join teachers t on t.id = tc.teacher_id
    where t.auth_user_id = auth.uid()
  ));
