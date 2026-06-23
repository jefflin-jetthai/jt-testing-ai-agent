#!/bin/bash
# 產出「node 版」zip：打包成單一 JS（bundle.cjs，免 node_modules），由系統 node 啟動。
# 避開 Gatekeeper（node 已被 Apple 核可），跨機器最穩。使用者需先裝 Node.js。
set -euo pipefail

cd "$(dirname "$0")/.."          # → bridge/
ROOT="$PWD"
OUT="$ROOT/sea/dist"
VERSION="$(node -p "require('./package.json').version")"
EXT_ID="gbodpgijbhekommdppfcgebacbpmedcj"
HOST_NAME="com.jt_testing.bridge_launcher"
APPDIR="JT Testing AI Agent"

echo "==> esbuild 打包單一 JS（含所有依賴）"
mkdir -p "$OUT"
npx --yes esbuild sea/entry.mjs \
  --bundle --platform=node --format=cjs \
  --outfile="$OUT/bundle.cjs" \
  --loader:.ts=ts --resolve-extensions=.ts,.mjs,.js,.json \
  --define:import.meta.url='"file:///bridge"' \
  --log-level=warning

STAGE="$OUT/zipnode/$APPDIR"
rm -rf "$OUT/zipnode"; mkdir -p "$STAGE"
cp "$OUT/bundle.cjs" "$STAGE/bundle.cjs"

# 帶上 extension（Load unpacked，固定 ID）
if [ -d "$ROOT/../extension" ]; then
  cp -R "$ROOT/../extension" "$STAGE/extension"
  find "$STAGE/extension" -name ".DS_Store" -delete 2>/dev/null || true
fi

# Install.command：偵測本機 node、產生 launcher、寫使用者層級 native host manifest
cat > "$STAGE/Install.command" <<EOF
#!/bin/bash
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
NODE="\$(command -v node || true)"
if [ -z "\$NODE" ]; then
  echo "❌ 找不到 Node.js。請先安裝（https://nodejs.org 或 brew install node）後再雙擊本檔。"
  echo "（可關閉此視窗）"; exit 1
fi
NODEDIR="\$(dirname "\$NODE")"

# launcher：用系統 node 跑 bundle（--native-host 模式）
cat > "\$DIR/launcher.sh" <<L
#!/bin/bash
export PATH="\$NODEDIR:\\\$PATH"
exec "\$NODE" "\$DIR/bundle.cjs" --native-host
L
chmod +x "\$DIR/launcher.sh"

for d in \\
  "\$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  parent="\$(dirname "\$d")"; [ -d "\$parent" ] || continue
  mkdir -p "\$d"
  cat > "\$d/$HOST_NAME.json" <<J
{
  "name": "$HOST_NAME",
  "description": "JT Testing AI Agent bridge launcher",
  "path": "\$DIR/launcher.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
J
  echo "✓ \$d/$HOST_NAME.json"
done
echo ""
echo "✅ 安裝完成！請勿移動此資料夾。"
echo "接著：載入 extension → 開 side panel → 按「連線」即可。"
echo "（可關閉此視窗）"
EOF
chmod +x "$STAGE/Install.command"

cat > "$STAGE/Uninstall.command" <<EOF
#!/bin/bash
for d in \\
  "\$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  rm -f "\$d/$HOST_NAME.json" 2>/dev/null || true
done
echo "✅ 已解除安裝。"
EOF
chmod +x "$STAGE/Uninstall.command"

cat > "$STAGE/README.txt" <<EOF
JT Testing AI Agent（macOS / node 版）

前置：請先安裝 Node.js（https://nodejs.org 或 brew install node）。

換電腦安裝步驟：
1. 把整個「${APPDIR}」資料夾放固定位置，勿日後移動。
2. 雙擊「Install.command」（被 Gatekeeper 擋：右鍵→開啟）。
3. 載入 extension：chrome://extensions → 開發人員模式 → 載入未封裝項目 → 選本資料夾內的 extension。
4. 開 side panel → Options 填 Notion Token → 按「連線」，bridge 自動啟動。

需自備：Node.js、claude / codex / agy、ffmpeg、git、uv（pytest）。
解除安裝：雙擊「Uninstall.command」。
EOF

ZIP="$OUT/JT-Testing-AI-Agent-bridge-node-$VERSION.zip"
rm -f "$ZIP"
( cd "$OUT/zipnode" && ditto -c -k --sequesterRsrc --keepParent "$APPDIR" "$ZIP" )
echo ""
echo "✅ 完成：$ZIP"
echo "使用者：先裝 Node → 解壓 → 雙擊 Install.command → Chrome 連線（避開 Gatekeeper）。"
