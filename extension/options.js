import { readTestCases } from "./notion.js";

const $ = (id) => document.getElementById(id);
const status = (msg, ok) => {
  $("status").textContent = msg;
  $("status").style.color = ok ? "var(--ok)" : "var(--muted)";
};

chrome.storage.sync.get(
  ["notionToken", "testPageId", "bridgeUrl"],
  (s) => {
    $("notion-token").value = s.notionToken || "";
    $("test-page-id").value = s.testPageId || "";
    $("bridge-url").value = s.bridgeUrl || "ws://localhost:8787";
  },
);

$("save").addEventListener("click", () => {
  chrome.storage.sync.set(
    {
      notionToken: $("notion-token").value.trim(),
      testPageId: $("test-page-id").value.trim(),
      bridgeUrl: $("bridge-url").value.trim() || "ws://localhost:8787",
    },
    () => status("已儲存 ✓", true),
  );
});

$("test").addEventListener("click", async () => {
  // 先存再測，確保 readTestCases 讀到最新值
  await new Promise((r) =>
    chrome.storage.sync.set(
      {
        notionToken: $("notion-token").value.trim(),
        testPageId: $("test-page-id").value.trim(),
      },
      r,
    ),
  );
  status("讀取中…");
  try {
    const { cases } = await readTestCases();
    status(`成功：讀到 ${cases.length} 個測試案例`, true);
  } catch (e) {
    status(`失敗：${e.message}`);
  }
});
