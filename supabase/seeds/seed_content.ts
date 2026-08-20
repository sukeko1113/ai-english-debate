/**
 * content/**.json の教材を DB へ投入する。
 *
 *   npm run seed:content                       # content/ 配下すべて
 *   npm run seed:content -- content/school-uniforms/beginner.json
 *
 * 教材の追加でコード変更が要らないようにするため、教材ファイルを列挙して
 * 読み込む形にしている（CLAUDE.md「教材をコードに埋め込まない」）。
 *
 * 何度実行しても同じ状態になる（topic code + level + version が同じなら上書き）。
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { closePool, transaction, type Transaction } from "../../lib/db/client";
import { LEVELS, QUESTION_TYPES, type Level, type QuestionType } from "../../lib/db/types";

const CONTENT_DIR = "content";

interface MaterialFile {
  topic: {
    code: string;
    title_en: string;
    title_ja: string;
    category?: string | null;
    status?: string;
  };
  material: {
    level: string;
    version: string;
    objectives: string[];
    script: string;
    script_ja_note?: string;
  };
  vocabulary?: { word: string; meaning: string; example?: string }[];
  grammar_points?: {
    point: string;
    explanation: string;
    examples?: string[];
  }[];
  questions?: {
    key: string;
    type: string;
    prompt: string;
    answer?: string;
    answer_note?: string;
    max_score?: number;
  }[];
  debate_tasks?: {
    side: string;
    prompt: string;
    constraints?: Record<string, unknown>;
    hint_topics_ja?: string[];
  }[];
  ai_counterarguments?: { against_side: string; text: string }[];
  model_answers?: Record<string, unknown>;
}

function assertLevel(value: string, where: string): Level {
  const level = LEVELS.find((candidate) => candidate === value);
  if (!level) {
    throw new Error(`${where}: 未知の level "${value}"`);
  }
  return level;
}

function assertQuestionType(value: string, where: string): QuestionType {
  const type = QUESTION_TYPES.find((candidate) => candidate === value);
  if (!type) {
    throw new Error(`${where}: 未知の question type "${value}"`);
  }
  return type;
}

function assertSide(value: string, where: string): "for" | "against" {
  if (value !== "for" && value !== "against") {
    throw new Error(`${where}: side は for / against のみ（"${value}"）`);
  }
  return value;
}

async function listMaterialFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMaterialFiles(path)));
    } else if (entry.name.endsWith(".json")) {
      files.push(path);
    }
  }
  return files.sort();
}

async function seedFile(tx: Transaction, path: string): Promise<void> {
  const data = JSON.parse(readFileSync(path, "utf8")) as MaterialFile;
  const where = relative(process.cwd(), path);
  const level = assertLevel(data.material.level, where);

  const topicRows = await tx.query<{ id: string }>(
    `insert into topics (code, title_en, title_ja, category, status)
     values ($1, $2, $3, $4, coalesce($5, 'draft'))
     on conflict (code) do update
       set title_en = excluded.title_en,
           title_ja = excluded.title_ja,
           category = excluded.category,
           status   = excluded.status
     returning id`,
    [
      data.topic.code,
      data.topic.title_en,
      data.topic.title_ja,
      data.topic.category ?? null,
      data.topic.status ?? null,
    ],
  );
  const topicId = topicRows[0]?.id;
  if (!topicId) throw new Error(`${where}: topic の投入に失敗した`);

  const materialRows = await tx.query<{ id: string }>(
    `insert into materials
       (topic_id, level, version, script, objectives, status,
        teacher_note, model_answers)
     values ($1, $2, $3, $4, $5::jsonb, 'approved', $6, $7::jsonb)
     on conflict (topic_id, level, version) do update
       set script        = excluded.script,
           objectives    = excluded.objectives,
           status        = excluded.status,
           teacher_note  = excluded.teacher_note,
           model_answers = excluded.model_answers
     returning id`,
    [
      topicId,
      level,
      data.material.version,
      data.material.script,
      JSON.stringify(data.material.objectives),
      data.material.script_ja_note ?? null,
      JSON.stringify(data.model_answers ?? {}),
    ],
  );
  const materialId = materialRows[0]?.id;
  if (!materialId) throw new Error(`${where}: material の投入に失敗した`);

  // 教材の子要素は入れ直す。JSON から消した項目が DB に残らないようにする。
  // questions は session_answers から参照されるため、既存セッションがあるときは
  // 消さずに upsert する（key が安定 ID の役目を持つ）。
  await tx.query(`delete from vocabulary where material_id = $1`, [materialId]);
  await tx.query(`delete from grammar_points where material_id = $1`, [
    materialId,
  ]);

  for (const [index, item] of (data.vocabulary ?? []).entries()) {
    await tx.query(
      `insert into vocabulary (material_id, ord, word, meaning, example)
       values ($1, $2, $3, $4, $5)`,
      [materialId, index, item.word, item.meaning, item.example ?? null],
    );
  }

  for (const [index, item] of (data.grammar_points ?? []).entries()) {
    await tx.query(
      `insert into grammar_points
         (material_id, ord, point, explanation, examples)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        materialId,
        index,
        item.point,
        item.explanation,
        JSON.stringify(item.examples ?? []),
      ],
    );
  }

  for (const [index, item] of (data.questions ?? []).entries()) {
    await tx.query(
      `insert into questions
         (material_id, key, ord, type, prompt, answer, answer_note, max_score)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (material_id, key) do update
         set ord         = excluded.ord,
             type        = excluded.type,
             prompt      = excluded.prompt,
             answer      = excluded.answer,
             answer_note = excluded.answer_note,
             max_score   = excluded.max_score`,
      [
        materialId,
        item.key,
        index,
        assertQuestionType(item.type, `${where} questions[${index}]`),
        item.prompt,
        item.answer ?? null,
        item.answer_note ?? null,
        item.max_score ?? 1,
      ],
    );
  }

  await tx.query(`delete from debate_tasks where topic_id = $1 and level = $2`, [
    topicId,
    level,
  ]);
  for (const [index, task] of (data.debate_tasks ?? []).entries()) {
    await tx.query(
      `insert into debate_tasks
         (topic_id, level, side, prompt, constraints, hint_topics)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        topicId,
        level,
        assertSide(task.side, `${where} debate_tasks[${index}]`),
        task.prompt,
        JSON.stringify(task.constraints ?? {}),
        JSON.stringify(task.hint_topics_ja ?? []),
      ],
    );
  }

  await tx.query(
    `delete from ai_counterarguments where topic_id = $1 and level = $2`,
    [topicId, level],
  );
  const perSide = new Map<string, number>();
  for (const [index, item] of (data.ai_counterarguments ?? []).entries()) {
    const side = assertSide(
      item.against_side,
      `${where} ai_counterarguments[${index}]`,
    );
    const ord = perSide.get(side) ?? 0;
    perSide.set(side, ord + 1);
    await tx.query(
      `insert into ai_counterarguments
         (topic_id, level, against_side, ord, text)
       values ($1, $2, $3, $4, $5)`,
      [topicId, level, side, ord, item.text],
    );
  }

  console.log(
    `  ${where} → topic=${data.topic.code} level=${level} v${data.material.version}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : await listMaterialFiles(CONTENT_DIR);

  if (files.length === 0) {
    throw new Error(`${CONTENT_DIR}/ に教材 JSON が無い`);
  }

  console.log(`教材を投入する（${files.length} 件）`);
  await transaction(async (tx) => {
    for (const file of files) {
      await seedFile(tx, file);
    }
  });
  console.log("完了");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
