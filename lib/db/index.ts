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
  getLessonPhases,
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
  setCurrentPhase,
  setSessionStatus,
  startLessonSession,
} from "./sessions";
