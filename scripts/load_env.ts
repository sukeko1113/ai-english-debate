/**
 * .env を読み込む。**副作用だけのモジュール。**
 *
 * next dev / next build は .env を自動で読むが、素の Node で動く
 * スクリプト（doctor / db:apply / seed:content）は読まない。
 * それらの先頭で、他の import より前にこれを読み込む。
 *
 * Node 22 の process.loadEnvFile を使うので依存は増やさない。
 * **すでに設定されている環境変数は上書きしない**ので、
 *   DATABASE_URL=... npm run db:apply
 * のようにコマンドラインで渡した値が優先される（Next と同じ順序）。
 */

import { existsSync } from "node:fs";

// Next.js と同じく .env.local を .env より優先する
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}
