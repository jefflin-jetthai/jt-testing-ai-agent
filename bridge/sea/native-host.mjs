/**
 * Native Messaging host（打包版）。被 Chrome 透過 connectNative 啟動。
 * 若 bridge 未在跑，就以 detached 方式啟動「自身 binary」(預設 = bridge server)。
 * stdout 僅能寫 native messaging 長度前綴訊息。
 */
import { spawn } from "node:child_process";
import net from "node:net";

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
    if (await isUp()) { send({ ok: true, already: true }); return finish(0); }
    // 啟動自身 binary（無 arg = bridge server），detached
    const child = spawn(process.execPath, [], { detached: true, stdio: "ignore", env: process.env });
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
