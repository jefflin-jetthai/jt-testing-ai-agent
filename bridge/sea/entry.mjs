/**
 * SEA 單一執行檔的入口（dispatcher）。一個 binary、三種模式（依 argv）：
 *   <bin>                → bridge server（預設）
 *   <bin> --browser-mcp  → 自建瀏覽器工具 MCP（attach 模式用）
 *   <bin> --native-host  → Native Messaging host（被 Chrome 啟動，負責拉起 bridge）
 *
 * 注意：SEA 以 CommonJS 執行，不可用 top-level await；故用「不 await 的 dynamic import」
 *       讓對應模組以 side-effect 方式啟動。esbuild --bundle 會把這些模組打進同一檔。
 */
// 打包版標記：讓設定/資料寫到使用者資料夾（並被 detached 子程序繼承）
process.env.JT_PACKAGED = "1";

// node 版（用系統 node 跑 bundle）：記住 bundle 路徑，供子程序（browser-mcp / 啟動 server）沿用。
// SEA 版：execPath = jt-bridge binary、無 script，這裡不設定。
if (/(^|\/)node\d*$/.test(process.execPath) && process.argv[1]) {
  process.env.JT_BRIDGE_SCRIPT = process.argv[1];
}

const argv = process.argv;

if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write("jt-bridge 1.0.0\n");
  process.exit(0);
} else if (argv.includes("--browser-mcp")) {
  import("../browser-mcp.mjs");
} else if (argv.includes("--native-host")) {
  import("./native-host.mjs");
} else {
  // bridge server 模式：讓 browser-mcp 子程序能用「自身 binary」啟動
  process.env.JT_BRIDGE_BIN = process.execPath;
  import("../src/server.ts");
}
