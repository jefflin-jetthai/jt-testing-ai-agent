#!/bin/bash
#
# 安裝 Native Messaging host，讓 extension 連線時能自動啟動 bridge。
# 用法：  ./install.sh <EXTENSION_ID>
#   <EXTENSION_ID> 從 chrome://extensions 找到本擴充、複製其 ID。
#
set -euo pipefail

HOST_NAME="com.jt_testing.bridge_launcher"
EXT_ID="${1:-}"

# 解析路徑
NATIVE_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="$(cd "$NATIVE_DIR/.." && pwd)"
EXT_DIR="$(cd "$BRIDGE_DIR/../extension" && pwd)"

# 未指定 ID → 由 extension 資料夾路徑推算 unpacked extension id
# （Chrome 規則：sha256(絕對路徑) 前 32 個 hex，每位 0-f 映射成 a-p）
if [ -z "$EXT_ID" ]; then
  HASH="$(printf '%s' "$EXT_DIR" | shasum -a 256 | cut -c1-32)"
  EXT_ID="$(printf '%s' "$HASH" | tr '0-9a-f' 'a-p')"
  echo "（未指定 ID，依路徑推算）extension 目錄: $EXT_DIR"
  echo "（未指定 ID，依路徑推算）extension id : $EXT_ID"
  echo "→ 請對照 chrome://extensions 上的 ID；若不同，改用: ./install.sh <正確ID>"
  echo ""
fi
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then echo "找不到 node，請先安裝 Node.js"; exit 1; fi
NODE_DIR="$(dirname "$NODE_BIN")"

# 產生 launcher.sh（設好 PATH 與 JT_BRIDGE_DIR 後 exec launcher.mjs）
LAUNCHER_SH="$NATIVE_DIR/launcher.sh"
cat > "$LAUNCHER_SH" <<EOF
#!/bin/bash
export PATH="$NODE_DIR:\$PATH"
export JT_BRIDGE_DIR="$BRIDGE_DIR"
exec "$NODE_BIN" "$NATIVE_DIR/launcher.mjs"
EOF
chmod +x "$LAUNCHER_SH"

# 產生 manifest 並安裝到各 Chromium 系瀏覽器的 NativeMessagingHosts 目錄
read -r -d '' MANIFEST <<EOF || true
{
  "name": "$HOST_NAME",
  "description": "JT Testing AI Agent bridge launcher",
  "path": "$LAUNCHER_SH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

TARGET_DIRS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
)

INSTALLED=0
for dir in "${TARGET_DIRS[@]}"; do
  parent="$(dirname "$dir")"
  if [ -d "$parent" ]; then
    mkdir -p "$dir"
    printf '%s\n' "$MANIFEST" > "$dir/$HOST_NAME.json"
    echo "✓ 已安裝: $dir/$HOST_NAME.json"
    INSTALLED=1
  fi
done

if [ "$INSTALLED" -eq 0 ]; then
  echo "⚠ 找不到 Chrome/Chromium 設定目錄；請確認已安裝 Chrome。"
  exit 1
fi

echo ""
echo "完成！extension id = $EXT_ID"
echo "之後在 side panel 按「連線」，bridge 沒開時會自動啟動。"
echo "（若改了 extension id 或搬移專案，重跑此腳本即可）"
