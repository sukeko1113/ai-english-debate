-- 0003_material_versions.sql — 教材ごとに採点基準・授業指示の版を持たせる
--
-- lesson_sessions.rubric_version / prompt_version は授業開始時に固定する
-- （docs/DATA_MODEL.md `lesson_sessions`）。どの版を固定するかを
-- コードの定数で決めると、基準を変えるたびにコード変更が要る。
-- content/**.json には既に "rubric_version" / "prompt_version" があるので、
-- 教材データ側から取れるようにする（CLAUDE.md「教材をコードに埋め込まない」）。

alter table materials add column rubric_version text not null default 'v1';
alter table materials add column prompt_version text not null default 'v1';
