import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig.json の paths（@/*）をそのまま使う
    tsconfigPaths: true,
  },
  test: {
    // API ルートと採点ロジックのテストが主。DOM が要るテストを足すときは
    // そのファイルだけ環境を上書きする。
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
