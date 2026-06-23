#!/bin/bash
# 把 bridge 打包成單一執行檔（Node SEA），內含 node，使用者免裝 node。
# 產出：bridge/sea/dist/jt-bridge
set -euo pipefail

cd "$(dirname "$0")/.."          # → bridge/
ROOT="$PWD"
OUT="$ROOT/sea/dist"
BIN="$OUT/jt-bridge"
rm -rf "$OUT"; mkdir -p "$OUT"

echo "==> [1/5] esbuild 打包 entry → 單一 CJS"
npx --yes esbuild sea/entry.mjs \
  --bundle --platform=node --format=cjs \
  --outfile="$OUT/bundle.cjs" \
  --loader:.ts=ts --resolve-extensions=.ts,.mjs,.js,.json \
  --define:import.meta.url='"file:///jt-bridge"' \
  --log-level=warning

echo "==> [2/5] 產生 SEA blob"
cat > "$OUT/sea-config.json" <<EOF
{ "main": "$OUT/bundle.cjs", "output": "$OUT/blob.blob", "disableExperimentalSEAWarning": true }
EOF
node --experimental-sea-config "$OUT/sea-config.json"

echo "==> [3/5] 複製 node 執行檔 → jt-bridge"
cp "$(command -v node)" "$BIN"
codesign --remove-signature "$BIN" 2>/dev/null || true

echo "==> [4/5] 注入 blob（postject）"
npx --yes postject "$BIN" NODE_SEA_BLOB "$OUT/blob.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

echo "==> [5/5] ad-hoc 簽章"
codesign --sign - "$BIN"

echo ""
echo "✅ 完成：$BIN"
"$BIN" --version 2>/dev/null || true
