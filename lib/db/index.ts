/**
 * lib/db の入口。
 *
 * DB クライアント（pg）に触れてよいのは lib/db/ の中だけ。
 * 外からは常にこのモジュール経由で使う。
 */
export * from "./types";
export { closePool, transaction } from "./client";
export {
  findMaterialId,
  getLessonMaterial,
  getQuestionsWithAnswers,
  questionBelongsToMaterial,
} from "./materials";
export {
  completeStep,
  findOwnedSession,
  findUnfinishedSession,
  setSessionStatus,
  startLessonSession,
} from "./sessions";
