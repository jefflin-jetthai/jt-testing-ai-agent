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

# 帶上 AI 測試規範（attach 模式 system prompt；使用者可編輯覆寫內建預設）
if [ -d "$ROOT/agents" ]; then
  cp -R "$ROOT/agents" "$STAGE/agents"
  find "$STAGE/agents" -name ".DS_Store" -delete 2>/dev/null || true
fi

# 帶上 extension（Load unpacked，固定 ID）
if [ -d "$ROOT/../extension" ]; then
  cp -R "$ROOT/../extension" "$STAGE/extension"
  find "$STAGE/extension" -name ".DS_Store" -delete 2>/dev/null || true
fi

# 帶上 Windows 安裝/解除安裝 .bat（與 bundle.cjs 同層；.bat 內以 %~dp0bundle.cjs 取用）
if [ -d "$ROOT/native-host/windows" ]; then
  find "$ROOT/native-host/windows" -maxdepth 1 -name "*.bat" -exec cp {} "$STAGE/" \;
fi

# Install.command：偵測本機 node、把 bundle 複製到「非 TCC 保護目錄」、寫 native host manifest
# （重要：Chrome 啟動 native host 時不能在 ~/Downloads /Desktop /Documents 等 TCC 保護目錄執行，
#   故複製到 ~/Library/Application Support，避開 TCC，與解壓位置無關。）
cat > "$STAGE/Install.command" <<EOF
#!/bin/bash
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
NODE="\$(command -v node || true)"
if [ -z "\$NODE" ]; then
  echo "❌ 找不到 Node.js。請先安裝（https://nodejs.org 或 brew install node）後再雙擊本檔。"
  echo "（可關閉此視窗）"; exit 1
fi
NODEDIR="\$(dirname "\$NODE")"
DEST="\$HOME/Library/Application Support/JT Testing AI Agent"

mkdir -p "\$DEST"
cp "\$DIR/bundle.cjs" "\$DEST/bundle.cjs"
# AI 測試規範（與 bundle 同層 agents/，供 attach 模式讀取；可日後編輯）
rm -rf "\$DEST/agents"; [ -d "\$DIR/agents" ] && cp -R "\$DIR/agents" "\$DEST/agents"
# 記下 extension 資料夾路徑，供「一鍵更新」時 bridge 覆蓋 extension 檔後自我 reload
printf '%s' "\$DIR/extension" > "\$DEST/extension-dir.txt"

# launcher（裝在非保護目錄）：用系統 node 跑 bundle（--native-host 模式）
cat > "\$DEST/launcher.sh" <<L
#!/bin/bash
export PATH="\$NODEDIR:\\\$PATH"
exec "\$NODE" "\$DEST/bundle.cjs" --native-host
L
chmod +x "\$DEST/launcher.sh"

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
  "path": "\$DEST/launcher.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
J
  echo "✓ \$d/$HOST_NAME.json"
done
echo ""
echo "✅ 安裝完成（bridge 已複製到 \$DEST）！"
echo "接著：在 chrome://extensions 載入本資料夾內的 extension（請保留此資料夾供 Chrome 讀取）。"
echo "然後開 side panel → 按「連線」即可。"
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
rm -rf "\$HOME/Library/Application Support/JT Testing AI Agent"
echo "✅ 已解除安裝。"
EOF
chmod +x "$STAGE/Uninstall.command"

cat > "$STAGE/README.txt" <<EOF
JT Testing AI Agent（macOS / node 版）

前置：請先安裝 Node.js（https://nodejs.org 或 brew install node）。

換電腦安裝步驟：
1. 把整個「${APPDIR}」資料夾放固定位置（給 Chrome 讀 extension 用，勿日後移動）。
   ※ 放哪都可以（含 Downloads）：Install 會把 bridge 複製到 ~/Library/Application Support。
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
