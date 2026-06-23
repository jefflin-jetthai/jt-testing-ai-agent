#!/bin/bash
# 產出「解壓→雙擊安裝」的 zip：內含單一執行檔 jt-bridge + 安裝/解除安裝.command。
# 使用者層級安裝（~/Library），免管理員、免 .pkg、免 node。
set -euo pipefail

cd "$(dirname "$0")/.."          # → bridge/
ROOT="$PWD"
OUT="$ROOT/sea/dist"
SEA_BIN="$OUT/jt-bridge"
VERSION="$(node -p "require('./package.json').version")"
EXT_ID="gbodpgijbhekommdppfcgebacbpmedcj"
HOST_NAME="com.jt_testing.bridge_launcher"
APPDIR="JT Testing AI Agent"

[ -f "$SEA_BIN" ] || bash "$ROOT/scripts/build-sea.sh"

STAGE="$OUT/zip/$APPDIR"
rm -rf "$OUT/zip"; mkdir -p "$STAGE"
cp "$SEA_BIN" "$STAGE/jt-bridge"; chmod +x "$STAGE/jt-bridge"

# 安裝.command：自我定位、寫使用者層級 native host manifest、移除 quarantine
cat > "$STAGE/安裝.command" <<EOF
#!/bin/bash
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
BIN="\$DIR/jt-bridge"

# 移除 quarantine，避免 Gatekeeper 擋（下載來的檔案）
xattr -dr com.apple.quarantine "\$DIR" 2>/dev/null || true
chmod +x "\$BIN"

# launcher 包一層：Chrome 啟動 native host → exec binary --native-host
cat > "\$DIR/launcher.sh" <<L
#!/bin/bash
exec "\$BIN" --native-host
L
chmod +x "\$DIR/launcher.sh"

for d in \\
  "\$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  parent="\$(dirname "\$d")"
  [ -d "\$parent" ] || continue
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
echo "✅ 安裝完成！請勿移動此資料夾（manifest 指向這裡）。"
echo "接著：載入 Chrome extension → 開 side panel → 按「連線」即可。"
echo "（可關閉此視窗）"
EOF
chmod +x "$STAGE/安裝.command"

# 解除安裝.command
cat > "$STAGE/解除安裝.command" <<EOF
#!/bin/bash
for d in \\
  "\$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  rm -f "\$d/$HOST_NAME.json" && echo "removed \$d/$HOST_NAME.json" 2>/dev/null || true
done
echo "✅ 已解除安裝（可刪除此資料夾）。"
EOF
chmod +x "$STAGE/解除安裝.command"

# 說明檔
cat > "$STAGE/README.txt" <<EOF
JT Testing AI Agent — bridge（macOS）

使用方式：
1. 把整個「${APPDIR}」資料夾放到固定位置（例如「應用程式」或家目錄），勿日後移動。
2. 雙擊「安裝.command」（若被 Gatekeeper 擋：右鍵 → 開啟）。
3. 在 Chrome 載入本 extension → 開 side panel → 按「連線」，bridge 會自動啟動。

需另外自備：claude / codex / agy、ffmpeg、git、uv（pytest）。
解除安裝：雙擊「解除安裝.command」。
EOF

ZIP="$OUT/JT-Testing-AI-Agent-bridge-mac-$VERSION.zip"
rm -f "$ZIP"
( cd "$OUT/zip" && ditto -c -k --sequesterRsrc --keepParent "$APPDIR" "$ZIP" )

echo ""
echo "✅ 完成：$ZIP"
echo "使用者：解壓 → 雙擊「安裝.command」→ Chrome 連線即可（免 node / 免 .pkg / 免管理員）。"
