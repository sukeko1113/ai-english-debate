import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev が CLAUDE.md へ自動でルールブロックを追記するのを止める。
  // CLAUDE.md はこのプロジェクトの実装ルールを人が書いて管理するファイルで、
  // ツールに書き換えさせない。Next 16 固有の作法は node_modules/next/dist/docs/ を読む。
  agentRules: false,
};

export default nextConfig;
