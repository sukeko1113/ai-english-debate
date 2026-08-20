-- 0005_lesson_phases.sql — 授業フェーズをアプリ側で保持する
--
-- docs/AI教師プロンプト_v03_ClubActivities授業実装用.md §6 の状態遷移は
-- S00_START 〜 S140_REVIEW_AND_SAVE の15段階で、
-- 0001_init.sql の lesson_sessions.current_step（1〜9 の check 制約）では表せない。
--
-- 既存 migration は書き換えない方針なので、列を足して並存させる。
--   current_step  … 基本設計書 §1.2 の9ステップ（既存。変更しない）
--   current_phase … v03 プロンプトの状態名（S00_START など）
--
-- 授業の進行状態はアプリ側が持つ。モデルの会話記憶に依存しない
-- （docs/REALTIME_ARCHITECTURE.md §5）。接続が切れても current_phase から再開する。

-- 教材ごとのフェーズ定義。質問・受理する答え・ヒントを含む。
-- **受理する答えとヒントは正解にあたるのでブラウザへ送らない。**
-- モデルへは session instructions 経由でのみ渡す（docs/API_SPEC.md）。
alter table materials add column lesson_phases jsonb not null default '[]'::jsonb;

alter table lesson_sessions add column current_phase text;
