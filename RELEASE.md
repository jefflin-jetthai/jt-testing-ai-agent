# 發版 SOP（線上更新用）

本工具支援「線上偵測新版 + bridge 半自動自我更新」。使用者（1.0.1+）連線時會抓本 repo 的
**GitHub Releases (`releases/latest`)** 比對版號，有新版就在 side panel 顯示更新列：

- **更新 bridge**：bridge 自動下載新 `bundle.cjs` 覆蓋自身（備份 `.bak`）→ 重啟 → 自動重連（全自動）
- **下載新版 zip**：手動更新 extension（unpacked 擴充無法自動更新之限制 → 需 reload 擴充）

## 前提

- **repo 需公開**，使用者才抓得到 Releases API 與 asset。
  私有時：在另一個公開 repo 發 Release，並請使用者於 **Options →「更新來源」** 填該公開 repo 的
  `https://api.github.com/repos/<owner>/<repo>/releases/latest`。
- 1.0.0 使用者沒有偵測碼，需**手動更新到 1.0.1 一次**，之後才會自動偵測。

## 每次發版步驟

1. **升版號**（兩處要一致）：
   - `extension/manifest.json` 的 `version`
   - `bridge/package.json` 的 `version`（決定 zip 檔名；設定頁版號讀 manifest）

2. **打包**：
   ```bash
   cd bridge && npm run build:zip
   ```
   產出於 `bridge/sea/dist/`：
   - `bundle.cjs` ← bridge 自我更新抓的檔
   - `JT-Testing-AI-Agent-bridge-node-<version>.zip` ← 使用者手動更新 extension 用

3. **建 GitHub Release**：
   - Tag：`v<version>`（例 `v1.0.2`；偵測會自動去掉開頭的 `v`）
   - 上傳**兩個 asset**：
     - **`bundle.cjs`**（檔名必須精確；擴充以 `name === "bundle.cjs"` 比對）
     - 上面那個 `.zip`（擴充以副檔名 `.zip` 比對）
   - Release notes 選填（目前 UI 未顯示）

4. **commit + push** 版號變更與任何程式調整。

## 使用者端體驗（一鍵更新，1.0.3+）

連線 → 有新版 → side panel 頂端綠色更新列 → 按單一「**更新**」鈕：
bridge 下載新 `bundle.cjs` + zip → 覆蓋自身 **與 extension 資料夾** → 擴充自動
`chrome.runtime.reload()` 套用新版。**不需手動下載、不需開 chrome://extensions**。

> 因 extension ID 固定，更新不需重設定、Notion Token 不會遺失。

### 一鍵更新的啟用前提

1. **需先安裝過 1.0.3+ 一次**（透過 Install.command）。更新機制是新加的，舊版沒有一鍵碼：
   - 已發布的 v1.0.2 沒有 → 1.0.2→1.0.3 仍走「手動換 extension」
   - **1.0.3 → 之後版本** 才是真正單鍵
2. **Install.command 會記錄 extension 資料夾路徑**（寫入 `~/Library/Application Support/JT Testing AI Agent/extension-dir.txt`）。
   bridge 一鍵更新時就是覆蓋這個資料夾 → **該資料夾請固定不動、勿刪除/搬移**。
3. 若該檔不存在（舊安裝/手動載入未經 Install.command）→ 自動退回「只更新 bridge + 顯示手動下載 zip」。

### 換機器 / 首次安裝（手動）

解壓 zip → 雙擊 **Install.command**（被 Gatekeeper 擋就右鍵→開啟）→
`chrome://extensions` 開發人員模式 → 載入未封裝 → 選資料夾內的 `extension`。
