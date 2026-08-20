import { StartLessonButton } from "@/components/lesson/StartLessonButton";
import { requireStudent } from "@/lib/auth/student";
import { findMaterialForLevel, getLessonMaterial } from "@/lib/db/materials";
import { findUnfinishedSession } from "@/lib/db/sessions";

/**
 * 生徒のトップ。今日の教材を出して授業へ入る入口
 * （docs/BASIC_DESIGN_v03.md §3.1 の 3〜4）。
 *
 * 画面は Server Component から lib/db を直接読む。API を経由しないのは
 * 同じサーバー内で1往復増やす意味が無いため。answer を select しない
 * getLessonMaterial を使う点は /api/lessons/today と同じ。
 */
export const dynamic = "force-dynamic";

export default async function StudentHome() {
  const student = await requireStudent();
  const materialId = await findMaterialForLevel(student.currentLevel);
  const material = materialId ? await getLessonMaterial(materialId) : null;
  const existing = materialId
    ? await findUnfinishedSession(student.id, materialId)
    : null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">今日の授業</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          {student.displayName} さん（レベル: {student.currentLevel}）
        </p>
      </div>

      {material ? (
        <>
          <div className="rounded border border-black/15 p-4 dark:border-white/20">
            <h2 className="text-lg font-bold">
              {material.topic.titleJa}
              <span className="ml-2 text-sm font-normal text-black/60 dark:text-white/60">
                {material.topic.titleEn}
              </span>
            </h2>
            <ul className="mt-3 list-disc pl-5 text-sm">
              {material.objectives.map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>
          </div>

          <StartLessonButton
            materialId={material.materialId}
            hasExistingSession={existing !== null}
          />
        </>
      ) : (
        <p className="text-sm">
          今日の教材が割り当てられていません。
        </p>
      )}
    </main>
  );
}
