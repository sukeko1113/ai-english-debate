import { SignInButton } from "@/components/auth/SignInButton";
import { isGoogleConfigured } from "@/lib/auth/options";
import { usingDevStudent } from "@/lib/auth/student";

/**
 * ログイン画面。
 *
 * **許可リストに載っているアカウントだけ入れる**（docs/SECURITY.md §3）。
 * 弾かれた場合もここへ戻る。
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">AI英語ディベート授業</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          音声で英語ディベートの授業を受けます。
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded border border-red-500/40 p-3 text-sm text-red-700 dark:text-red-300"
        >
          このアカウントではログインできません。
          利用を許可されたアカウントでお試しください。
        </p>
      ) : null}

      {usingDevStudent() ? (
        <p className="rounded border border-black/15 p-3 text-sm dark:border-white/20">
          開発用の設定で動いています。ログインせずに
          <a className="underline" href="/student">
            {" "}
            授業画面
          </a>
          へ進めます。
        </p>
      ) : isGoogleConfigured() ? (
        <SignInButton />
      ) : (
        <p className="text-sm">ログインの設定がまだされていません。</p>
      )}

      <section className="rounded border border-black/15 p-4 text-sm dark:border-white/20">
        <h2 className="font-bold">使う前に知っておいてください</h2>
        <ul className="mt-2 list-disc pl-5 text-black/70 dark:text-white/70">
          <li>
            <strong>会話の書き起こしが保存されます。</strong>
            音声そのものは保存しません。
          </li>
          <li>答えは日本語で構いません。</li>
          <li>授業中に点数は出ません。</li>
          <li>30〜40分かかります。途中でやめても、続きから戻れます。</li>
        </ul>
      </section>
    </main>
  );
}
