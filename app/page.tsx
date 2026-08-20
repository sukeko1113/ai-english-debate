import { redirect } from "next/navigation";

/**
 * トップページ。生徒画面へ送るだけ。
 *
 * 教師画面ができたら、ここで役割に応じて振り分ける。
 * TODO(要確認): 認証を本実装したら、ログイン状態と役割で行き先を決める。
 */
export default function Home() {
  redirect("/student");
}
