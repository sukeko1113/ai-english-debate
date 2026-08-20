import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev が CLAUDE.md へ自動でルールブロックを追記するのを止める。
  // CLAUDE.md はこのプロジェクトの実装ルールを人が書いて管理するファイルで、
  // ツールに書き換えさせない。Next 16 固有の作法は node_modules/next/dist/docs/ を読む。
  agentRules: false,

  // 開発用インジケータの既定位置（左下）は授業画面の「開始」ボタンと重なる。
  // 開発中にマイクを押せなくなるので右上へ逃がす。
  devIndicators: { position: "top-right" },
};

export default nextConfig;
