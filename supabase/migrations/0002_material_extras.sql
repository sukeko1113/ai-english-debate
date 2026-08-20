-- 0002_material_extras.sql — 教材 JSON に存在して 0001 に置き場所が無かった項目を足す
--
-- content/school-uniforms/beginner.json には 0001_init.sql のテーブルへ入らない
-- 項目が4つある。教材データを落とさずに投入できるようにする。
--
--   script_ja_note   → materials.teacher_note
--   model_answers    → materials.model_answers
--   hint_topics_ja   → debate_tasks.hint_topics
--   ai_counterarguments → ai_counterarguments テーブル（新設）
--
-- ai_counterarguments は docs/LESSON_FLOW.md Step 8 の
-- 「教材の反論を使う」を満たすために必要。教材側に持たせ、コードに埋め込まない。

-- ------------------------------------------------------------
-- materials
-- ------------------------------------------------------------

-- 教員向けの補足。生徒画面にもモデルにも渡さない
alter table materials add column teacher_note text;

-- 模範解答。生徒画面へ送らない。教員表示と採点の参考にのみ使う
alter table materials add column model_answers jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------
-- debate_tasks
-- ------------------------------------------------------------

-- 生徒が行き詰まったときに示す「観点」。答えそのものではない
-- （docs/LESSON_FLOW.md Step 5「観点だけを示す」）
alter table debate_tasks add column hint_topics jsonb not null default '[]'::jsonb;

-- ------------------------------------------------------------
-- ai_counterarguments
-- ------------------------------------------------------------

-- Step 8 で AI が使う反論。教材ごと・レベルごとに用意する。
-- against_side は「生徒がどちらの立場のときに使う反論か」を表す。
--   against_side = 'for'     → 制服に賛成した生徒への反論
--   against_side = 'against' → 制服に反対した生徒への反論
create table ai_counterarguments (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null references topics(id) on delete cascade,
  level        text not null check (level in ('beginner','intermediate','advanced')),
  against_side text not null check (against_side in ('for','against')),
  ord          int  not null,
  text         text not null,
  unique (topic_id, level, against_side, ord)
);

create index on ai_counterarguments (topic_id, level, against_side);
