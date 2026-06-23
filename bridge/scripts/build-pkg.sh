#!/bin/bash
# 產出 macOS .pkg：把 jt-bridge 單一執行檔裝到固定位置，並安裝 Native Messaging host（固定 ID）。
# 需先跑 build-sea.sh 產生 sea/dist/jt-bridge。
# 產出：bridge/sea/dist/JT-Testing-AI-Agent-<version>.pkg
set -euo pipefail

cd "$(dirname "$0")/.."          # → bridge/
ROOT="$PWD"
SEA_BIN="$ROOT/sea/dist/jt-bridge"
VERSION="$(node -p "require('./package.json').version")"
EXT_ID="gbodpgijbhekommdppfcgebacbpmedcj"   # 固定 extension ID（manifest key 推導）
HOST_NAME="com.jt_testing.bridge_launcher"
INSTALL_DIR="/Library/Application Support/JT Testing AI Agent"   # 系統層級安裝（pkg 需管理員密碼）
PKG_ID="com.jt_testing.bridge"

[ -f "$SEA_BIN" ] || { echo "找不到 $SEA_BIN，請先跑 build-sea.sh"; exit 1; }

BUILD="$ROOT/sea/dist/pkgbuild"
ROOTFS="$BUILD/root"
SCRIPTS="$BUILD/scripts"
rm -rf "$BUILD"; mkdir -p "$ROOTFS$INSTALL_DIR" "$SCRIPTS"

echo "==> 準備 payload"
cp "$SEA_BIN" "$ROOTFS$INSTALL_DIR/jt-bridge"
chmod +x "$ROOTFS$INSTALL_DIR/jt-bridge"

# launcher 包一層：Chrome 啟動 native host 時，exec binary --native-host
cat > "$ROOTFS$INSTALL_DIR/launcher.sh" <<EOF
#!/bin/bash
exec "$INSTALL_DIR/jt-bridge" --native-host
EOF
chmod +x "$ROOTFS$INSTALL_DIR/launcher.sh"

echo "==> 準備 postinstall（寫入 Native Messaging host manifest）"
cat > "$SCRIPTS/postinstall" <<EOF
#!/bin/bash
set -e
# 系統層級 manifest，對所有使用者生效；Chrome / Chromium 皆寫
for d in \\
  "/Library/Google/Chrome/NativeMessagingHosts" \\
  "/Library/Application Support/Chromium/NativeMessagingHosts"; do
  mkdir -p "\$d"
  cat > "\$d/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "JT Testing AI Agent bridge launcher",
  "path": "$INSTALL_DIR/launcher.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
done
exit 0
EOF
chmod +x "$SCRIPTS/postinstall"

echo "==> pkgbuild"
PKG="$ROOT/sea/dist/JT-Testing-AI-Agent-$VERSION.pkg"
pkgbuild \
  --root "$ROOTFS" \
  --scripts "$SCRIPTS" \
  --identifier "$PKG_ID" \
  --version "$VERSION" \
  --install-location "/" \
  "$PKG"

echo ""
echo "✅ 完成：$PKG"
echo "（未簽章。自用：右鍵→開啟。對外散佈需 Apple Developer ID 簽章 + notarize：）"
echo "  productsign --sign \"Developer ID Installer: <Name> (<TeamID>)\" \"$PKG\" \"\${PKG%.pkg}-signed.pkg\""
echo "  xcrun notarytool submit ... && xcrun stapler staple ..."
