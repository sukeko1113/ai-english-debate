/**
 * lib/db の入口。
 *
 * DB クライアント（pg）に触れてよいのは lib/db/ の中だけ。
 * 外からは常にこのモジュール経由で使う。
 */
export * from "./types";
export { closePool, transaction } from "./client";
export {
  findMaterialForLevel,
  findMaterialId,
  getLessonMaterial,
  getMaterialVersions,
  getQuestionsWithAnswers,
  questionBelongsToMaterial,
} from "./materials";
export { countRecentCalls, recordRealtimeCall } from "./realtime";
export { getStudentByAuthUserId, getStudentById } from "./students";
export {
  completeStep,
  findOwnedSession,
  findUnfinishedSession,
  setSessionStatus,
  startLessonSession,
} from "./sessions";
