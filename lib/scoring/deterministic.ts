import { normalizeAnswer } from "./normalize";

/**
 * 確定採点（docs/RUBRIC.md「採点方法の3分類」）。
 *
 * **純粋関数。AI を使わない。副作用を持たせない。**
 * DB も時計も参照しないので、同じ入力なら常に同じ結果になる。
 *
 * ここで扱うのはディクテーションだけ。英作文・論述・ルーブリック各軸は
 * モデル採点（lib/scoring/model.ts）の担当。
 */

/**
 * Language Accuracy 20点のうち、確定採点が持つ配点
 * （docs/RUBRIC.md「ルーブリック v1」: 確定10 + モデル10）。
 */
export const DICTATION_MAX_SCORE = 10;

export interface DictationResult {
  correct: boolean;
  /** 生徒の答案を正規化したもの。教員が結果を確認するために残す */
  normalized: string;
  expectedNormalized: string;
}

/** 1文のディクテーションを照合する */
export function scoreDictation(
  answer: string,
  expected: string,
): DictationResult {
  const normalized = normalizeAnswer(answer);
  const expectedNormalized = normalizeAnswer(expected);

  return {
    correct: normalized.length > 0 && normalized === expectedNormalized,
    normalized,
    expectedNormalized,
  };
}

export interface DictationItem {
  /** questions.key。どの問題かを教員が追えるように残す */
  key: string;
  /**
   * 生徒の答案（生のまま）。**答えていない問題は null。**
   * 未回答は不正解として数える。飛ばした方が得になってはいけない。
   */
  answerText: string | null;
  /** 教材の正解 */
  expected: string;
}

export interface DictationEvidence {
  key: string;
  correct: boolean;
  /** 答案があったか。無回答と誤答を教員が区別できるようにする */
  answered: boolean;
  normalized: string;
  expectedNormalized: string;
}

export interface DictationScore {
  /** ディクテーション項目が無ければ false。呼び出し側が扱いを決める */
  applicable: boolean;
  total: number;
  correct: number;
  rawScore: number;
  maxScore: number;
  /** scores.evidence へそのまま入れる。根拠が無いと教員が修正を判断できない */
  evidence: DictationEvidence[];
}

/**
 * ディクテーション一式を採点する。
 *
 * 配点は正答率に比例させ、0.5 点刻みを避けるため四捨五入する。
 * 項目が無い教材（Club Activities など）では applicable: false を返し、
 * 満点の扱いは呼び出し側（/finish）に委ねる。
 *
 * **未回答は不正解として分母に数える。** 答えなかった問題を分母から外すと、
 * 飛ばすほど得点率が上がってしまう。
 *
 * TODO(要確認): 途中で終わった授業（時間切れ・接続断）では、扱わなかった
 * 問題まで不正解になる。授業がどこまで進んだかを見て分母を決めるべきか、
 * 教員と決める必要がある。いまは教員が score_overrides で直せる。
 *
 * TODO(要確認): 満点をどう扱うか。docs/RUBRIC.md「MVP での扱い」は
 * Speaking を採点しない場合の満点を「85点にするか教員入力必須にするか」
 * 実装前に確認せよとしている。ディクテーションが無い教材でも同じ判断が要る。
 */
export function scoreDictationSet(
  items: readonly DictationItem[],
): DictationScore {
  const evidence = items.map((item): DictationEvidence => {
    const result = scoreDictation(item.answerText ?? "", item.expected);
    return {
      key: item.key,
      correct: result.correct,
      answered: item.answerText !== null,
      normalized: result.normalized,
      expectedNormalized: result.expectedNormalized,
    };
  });

  const total = evidence.length;
  const correct = evidence.filter((entry) => entry.correct).length;

  if (total === 0) {
    return {
      applicable: false,
      total: 0,
      correct: 0,
      rawScore: 0,
      maxScore: 0,
      evidence,
    };
  }

  return {
    applicable: true,
    total,
    correct,
    rawScore: Math.round((correct / total) * DICTATION_MAX_SCORE),
    maxScore: DICTATION_MAX_SCORE,
    evidence,
  };
}

export interface RecordedAnswer {
  questionId: string;
  attemptNo: number;
  answerText: string;
}

/**
 * 採点対象にする試行を選ぶ。
 *
 * **最初の試行を採点する。** session_answers に入っているのは生徒が最初に
 * 言った内容で、モデルに直させた版ではない（docs/DATA_MODEL.md）。
 *
 * TODO(要確認): 最初の試行と最後の試行のどちらを採点するかは、
 * 成績の公平性に関わる判断。Improvement 軸（授業内の改善）は
 * 試行の差を見るので、確定採点をどちらに合わせるか教員と決める必要がある。
 */
export function selectScoredAttempt(
  answers: readonly RecordedAnswer[],
  questionId: string,
): RecordedAnswer | null {
  const forQuestion = answers
    .filter((answer) => answer.questionId === questionId)
    .sort((left, right) => left.attemptNo - right.attemptNo);

  return forQuestion[0] ?? null;
}
