#!/usr/bin/env bash
# 發版自動化：bump 版號 → 打包 → commit + tag →（有 gh 就建 Release，否則印手動步驟）
# 用法：cd bridge && npm run release -- <version>     例：npm run release -- 1.0.4
set -euo pipefail

VER="${1:-}"
if ! [[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "用法: npm run release -- <version>（x.y.z）  例: npm run release -- 1.0.4"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$BRIDGE/.." && pwd)"
MANIFEST="$ROOT/extension/manifest.json"
PKG="$BRIDGE/package.json"

cd "$ROOT"

# 0) 工作區需乾淨（避免把無關變更一起 commit）
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作區有未提交的變更，請先處理乾淨再發版。"
  git status --short
  exit 1
fi

CUR="$(node -p "require('$PKG').version")"
echo "▶ 發版 v$CUR → v$VER"

# 1) bump 版號（manifest + package.json；只動 \"version\": \"x.y.z\"）
sed -i '' -E 's/("version"[[:space:]]*:[[:space:]]*)"[0-9]+\.[0-9]+\.[0-9]+"/\1"'"$VER"'"/' "$MANIFEST"
sed -i '' -E 's/("version"[[:space:]]*:[[:space:]]*)"[0-9]+\.[0-9]+\.[0-9]+"/\1"'"$VER"'"/' "$PKG"
echo "  ✓ manifest: $(grep -o '"version": "[^"]*"' "$MANIFEST")"
echo "  ✓ package : $(grep -o '"version": "[^"]*"' "$PKG" | head -1)"

# 2) 打包
( cd "$BRIDGE" && npm run build:zip >/dev/null )
ZIP="$BRIDGE/sea/dist/JT-Testing-AI-Agent-bridge-node-$VER.zip"
BUNDLE="$BRIDGE/sea/dist/bundle.cjs"
[ -f "$ZIP" ] && [ -f "$BUNDLE" ] || { echo "❌ 打包產物缺失"; exit 1; }
echo "  ✓ 打包完成"

# 3) commit + tag
git add "$MANIFEST" "$PKG"
git commit -q -m "chore: release v$VER"
git tag -a "v$VER" -m "v$VER"
echo "  ✓ 已 commit + tag v$VER"

# 4) 建 Release（有 gh 全自動；否則印手動步驟）
if command -v gh >/dev/null 2>&1; then
  git push origin HEAD --tags
  gh release create "v$VER" "$BUNDLE" "$ZIP" --title "v$VER" --generate-notes
  echo "✅ 已 push 並建立 GitHub Release v$VER（assets 已上傳）"
else
  echo ""
  echo "✅ 本機已就緒。未安裝 gh CLI，請手動完成最後兩步："
  echo "  1) git push origin main --tags"
  echo "  2) 到 GitHub 建 Release（tag v$VER），上傳這兩個 asset："
  echo "       $BUNDLE"
  echo "       $ZIP"
fi
