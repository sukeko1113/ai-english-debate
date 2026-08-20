#!/bin/bash
# クラウドセッション起動時にのみ依存をインストールする。
# ローカルでは何もしない（CLAUDE_CODE_REMOTE で判定）。
set -u

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ -f package.json ] && [ ! -d node_modules ]; then
  npm install || true
fi

exit 0
