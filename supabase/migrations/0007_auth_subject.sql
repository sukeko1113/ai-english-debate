-- 0007_auth_subject.sql — 外部の認証プロバイダのユーザーを紐づける
--
-- 0001 の students.auth_user_id は uuid で、Supabase Auth を想定していた。
-- Google など OAuth プロバイダの sub は uuid ではない文字列なので入らない。
--
-- プロバイダを問わない列を足す。値は「プロバイダ名:sub」の形で入れる。
-- 例: google:1234567890
--
-- **メールアドレスを主キー代わりにしない。** Google 側でメールが変わっても
-- 同じ人だと分かるようにするため、sub を使う。
alter table students add column auth_subject text unique;

create index on students (auth_subject);
