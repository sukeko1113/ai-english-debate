export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold">AI英語ディベート授業システム</h1>
      <p className="text-sm">
        プロジェクトの土台のみ。生徒画面・教師画面・API はまだ実装していない。
      </p>
      <p className="text-sm">
        実装の順序は <code>docs/TASKS.md</code>、設計は{" "}
        <code>docs/BASIC_DESIGN_v03.md</code> を参照。
      </p>
    </main>
  );
}
