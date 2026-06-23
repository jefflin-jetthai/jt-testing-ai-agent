/**
 * Native Messaging host：被 Chrome extension 透過 connectNative 啟動。
 * 任務：若 bridge 未在跑，就以 detached 方式啟動它，並用 native messaging 協定回報結果。
 *
 * 重要：stdout 是 native messaging 通道，**只能**寫長度前綴的訊息，
 *      任何除錯輸出一律走 stderr，否則 Chrome 會解析失敗。
 *
 * 由 install.sh 產生的 launcher.sh 包一層（設好 PATH + JT_BRIDGE_DIR）再 exec 本檔。
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 自我定位：本檔在 <bridge>/native-host/launcher.mjs → bridge 目錄 = 上一層
const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = process.env.JT_BRIDGE_DIR || dirname(SELF_DIR);
const PORT = Number(process.env.BRIDGE_PORT || 8787);

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function isUp() {
  return new Promise((resolve) => {
    const s = net.connect(PORT, "127.0.0.1");
    s.setTimeout(800);
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.on("timeout", () => { s.destroy(); resolve(false); });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const finish = (code = 0) => setTimeout(() => process.exit(code), 120);

(async () => {
  try {
    if (!BRIDGE_DIR) { send({ ok: false, error: "JT_BRIDGE_DIR 未設定" }); return finish(1); }
    if (await isUp()) { send({ ok: true, already: true }); return finish(0); }

    // detached 啟動 bridge（npm start，不帶 watch，便於由 UI 乾淨關閉），與 launcher 生命週期脫鉤
    const child = spawn("npm", ["start"], {
      cwd: BRIDGE_DIR,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();

    for (let i = 0; i < 40; i++) {
      if (await isUp()) { send({ ok: true, started: true }); return finish(0); }
      await wait(500);
    }
    send({ ok: false, error: "bridge 啟動逾時（20s）" });
    finish(1);
  } catch (e) {
    send({ ok: false, error: String(e?.message || e) });
    finish(1);
  }
})();
