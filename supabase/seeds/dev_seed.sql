-- dev_seed.sql — 開発用の固定データ
--
-- 教材そのものは content/**.json から投入する（npm run seed:content）。
-- ここに入れるのは、教材 JSON に無くて開発に要るものだけ。
--
--   1. ルーブリック v1（docs/RUBRIC.md）
--   2. 架空のクラス・教師・生徒
--
-- **実在の生徒名を入れないこと**（CLAUDE.md「秘密情報と生徒実データをコミットしない」）。
-- 何度実行しても同じ状態になるように書く。

-- ============================================================
-- ルーブリック v1（docs/RUBRIC.md「ルーブリック v1」）
-- 配点は3レベル共通。descriptors だけレベル別にする
-- ============================================================

delete from rubrics where version = 'v1';

insert into rubrics (version, axis, level, max_score, scorer_kind, descriptors)
select
  'v1',
  axis,
  level,
  max_score,
  scorer_kind,
  jsonb_build_object('full_marks', descriptor)
from (
  values
    -- axis,               max_score, scorer_kind,     level,          descriptor
    ('language_accuracy',  20, 'deterministic', 'beginner',     'ディクテーションが正確で、基本文の語順・語彙に大きな誤りがない'),
    ('language_accuracy',  20, 'deterministic', 'intermediate', '複文でも語順・時制が保てている'),
    ('language_accuracy',  20, 'deterministic', 'advanced',     '抽象語彙・比較表現を正確に使える'),

    ('comprehension',      15, 'model',         'beginner',     '本文の事実質問に答えられる'),
    ('comprehension',      15, 'model',         'intermediate', '本文の理由関係を説明できる'),
    ('comprehension',      15, 'model',         'advanced',     '相手の主張の前提まで読み取れる'),

    -- MVP では採点しない。記録のみ（docs/RUBRIC.md「MVP での扱い」）
    ('speaking',           15, 'record_only',   'beginner',     'MVP では採点しない。記録のみ'),
    ('speaking',           15, 'record_only',   'intermediate', 'MVP では採点しない。記録のみ'),
    ('speaking',           15, 'record_only',   'advanced',     'MVP では採点しない。記録のみ'),

    ('claim',              10, 'model',         'beginner',     '賛成か反対かをはっきり述べている'),
    ('claim',              10, 'model',         'intermediate', '立場を述べ、範囲を限定できる'),
    ('claim',              10, 'model',         'advanced',     '条件付きの立場を明確に述べられる'),

    ('reasoning',          20, 'model',         'beginner',     '独立した理由を2つ、because を使って述べられる'),
    ('reasoning',          20, 'model',         'intermediate', '理由を具体例で補強し、簡単な反論に応答できる'),
    ('reasoning',          20, 'model',         'advanced',     '複数根拠を比較し、反論に再反論できる'),

    ('interaction',        10, 'model',         'beginner',     '反論に対して黙り込まず応答できる'),
    ('interaction',        10, 'model',         'intermediate', '相手の反論を受けて自分の理由を言い直せる'),
    ('interaction',        10, 'model',         'advanced',     '相手の論点を特定して応答できる'),

    ('improvement',        10, 'model',         'beginner',     '2回目の発話で言い直しが改善している'),
    ('improvement',        10, 'model',         'intermediate', '指摘を次の発話に反映できている'),
    ('improvement',        10, 'model',         'advanced',     '指摘なしで自ら修正できている')
) as t(axis, max_score, scorer_kind, level, descriptor);

-- ============================================================
-- 架空のクラス・教師・生徒
-- UUID は固定にして、開発中に何度流しても同じ ID になるようにする
-- ============================================================

insert into classes (id, name, school_code)
values ('11111111-1111-4111-8111-111111111111', '開発用クラス 1年A組', 'DEV-SCHOOL')
on conflict (id) do update set name = excluded.name;

insert into teachers (id, auth_user_id, display_name)
values ('22222222-2222-4222-8222-222222222222', null, '開発用 教員')
on conflict (id) do update set display_name = excluded.display_name;

insert into teacher_classes (teacher_id, class_id)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111')
on conflict do nothing;

-- 架空の生徒。実在の氏名を入れないこと
insert into students (id, auth_user_id, class_id, display_name, current_level)
values
  -- 生徒A は Club Activities（intermediate）を受ける。
  -- 今日の教材は生徒のレベルで選ぶため（lib/db/materials.ts findMaterialForLevel）
  ('33333333-3333-4333-8333-333333333333', null,
   '11111111-1111-4111-8111-111111111111', '開発用 生徒A', 'intermediate'),
  ('44444444-4444-4444-8444-444444444444', null,
   '11111111-1111-4111-8111-111111111111', '開発用 生徒B', 'beginner')
on conflict (id) do update
  set display_name = excluded.display_name,
      current_level = excluded.current_level;
