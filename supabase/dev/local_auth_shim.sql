-- local_auth_shim.sql — ローカル PostgreSQL 用のダミー auth スキーマ
--
-- 0001_init.sql の RLS ポリシーは Supabase の auth.uid() を参照する。
-- 素の PostgreSQL にはこの関数が無いため、migration を流す前にこれを実行する。
--
-- **開発用。Supabase / 本番では絶対に実行しない。**
-- Supabase には同名の auth スキーマが既に存在する。
--
-- 使い方は README.md の「ローカルDB（開発用）」を参照。

create schema if not exists auth;

-- Supabase の auth.uid() 相当。ローカルではセッション変数から読む。
--   set local request.jwt.claim.sub = '<uuid>';
-- を実行すると、その生徒として RLS を試せる。未設定なら null。
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;
