/**
 * 圖片文字辨識（OCR）：翻譯規格比對點擊圖片時，extension 把圖片以 dataURL 送來，
 * 由本機 claude CLI 的視覺能力辨識出文字回傳（花字/藝術字/任意語言都可）。
 *
 * 認證同測試執行：使用 claude CLI 自身登入。model 預設 haiku（快、便宜），
 * 可用環境變數 OCR_MODEL 覆寫。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { augmentedEnv, commandExists } from "./agents/env.js";

const OCR_TIMEOUT_MS = 60_000;
const OCR_MODEL = process.env.OCR_MODEL ?? "haiku";

export async function ocrImage(dataUrl: string): Promise<{ text: string }> {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(
    (dataUrl ?? "").trim(),
  );
  if (!m) throw new Error("無效的圖片資料（需 data:image/*;base64）");
  if (!(await commandExists("claude"))) {
    throw new Error("本機找不到 claude CLI，圖片辨識需要它（與執行 AI 測試相同）");
  }

  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const dir = mkdtempSync(join(tmpdir(), "jt-ocr-"));
  const file = join(dir, `image.${ext}`);
  writeFileSync(file, Buffer.from(m[2], "base64"));
  try {
    const text = await runClaudeOcr(file);
    return { text: text === "NO_TEXT" ? "" : text };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runClaudeOcr(file: string): Promise<string> {
  const prompt =
    `讀取圖片 ${file}，輸出圖片中出現的所有文字。` +
    `只輸出文字本身（保持原語言與畫面順序，多段以換行分隔），` +
    `不要任何說明、翻譯或格式修飾。圖片中沒有文字時輸出 NO_TEXT。`;
  const args = [
    "-p",
    "--output-format",
    "text",
    "--model",
    OCR_MODEL,
    "--allowedTools",
    "Read",
    "--permission-mode",
    "bypassPermissions",
    prompt,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { env: augmentedEnv() });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("圖片辨識逾時（60 秒）"));
    }, OCR_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`無法啟動 claude CLI：${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code === 0 && text) return resolve(text);
      reject(new Error(text || err.trim() || `claude 結束碼 ${code}`));
    });
  });
}
