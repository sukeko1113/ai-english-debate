-- 0006_scoring_feedback.sql — 採点実行に振り返りコメントを持たせる
--
-- docs/API_SPEC.md「GET /api/lesson-sessions/:id/result」は
-- feedback（goodPoints / nextGoal）を返す。軸ごとの点数は scores にあるが、
-- 授業全体への短いコメントの置き場が 0001 に無い。
--
-- scores（軸ごと）とは粒度が違うので scoring_runs 側へ持たせる。
-- 再採点すれば新しい run に新しい feedback が入る。

alter table scoring_runs add column feedback jsonb;
