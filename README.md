# JT Testing AI Agent

把人工 E2E 測試進階成「AI Agent 輔助 / 接管」的 Chrome Extension。

讀 Notion 測試案例 → AI Agent 接管當前分頁即時執行 → 產出可貼 Notion 的 markdown + 每測項 `.gif` → 可把通過的案例固化成符合 [automatic-testing](../automatic-testing) 框架的 pytest，於本地 clone 建立 commit（不自動 push）。

> 本專案是「控制面板 + 橋接器」，重用本地 `automatic-testing`（AT repo）既有的 Notion MCP、chrome-devtools-mcp、specs/tests 架構與錄影 plugin，不重造輪子。

## 元件

- `extension/` — MV3 Chrome 擴充（side panel UI + service worker + options）。免建置純 JS，可直接 Load unpacked。
  - **Notion 讀取在 extension 端直接 fetch**（模式參考 `../chrome-traslate-compare-plugin`），token 存 `chrome.storage.sync`，於 Options 頁設定。
- `bridge/` — 本地 Node + TS 服務：WebSocket hub、CDP proxy、agent 編排、錄影轉 gif、pytest 匯出、git。不經手 Notion。

## macOS 散佈（免裝 Node）

bridge 打包成**單一執行檔（Node SEA，內含 node）**，使用者**不需 Node / npm**。3 模式：`server`（預設）/ `--browser-mcp` / `--native-host`。

兩種包裝（打包者跑）：

```bash
cd bridge
npm run build:zip    # 推薦：解壓→雙擊安裝的 zip（使用者層級、免管理員、免 .pkg）
npm run build:pkg    # 或：.pkg 安裝包（系統層級，需管理員密碼）
```

### A. zip（推薦，最簡單）— 已端到端驗證
產出 `sea/dist/JT-Testing-AI-Agent-bridge-mac-<version>.zip`，內含 `jt-bridge` + `安裝.command` + `解除安裝.command`。

**使用者**：
1. 解壓，把資料夾放固定位置（勿日後移動）
2. 雙擊「**安裝.command**」（被 Gatekeeper 擋就右鍵→開啟；腳本會自動移除 quarantine、寫使用者層級 native host manifest）
3. 載入 Chrome extension（固定 ID `gbodpgijbhekommdppfcgebacbpmedcj`）→ 開 side panel → 按「連線」→ bridge 自動啟動

### B. .pkg（系統層級）
產出 `sea/dist/JT-Testing-AI-Agent-<version>.pkg`，雙擊安裝（需管理員密碼），postinstall 寫系統層級 manifest。未簽章自用右鍵→開啟；對外散佈需 Apple Developer ID 簽章 + notarize（指令見 `scripts/build-pkg.sh` 結尾）。

> 仍需各自安裝/登入的外部工具：agent CLI（`claude` / `codex` / `agy`）、`ffmpeg`、`git`、`uv`（pytest）。
> 註：remote 模式用到 `npx chrome-devtools-mcp` 仍需 Node；attach 模式（預設）走打包進 binary 的 jt-browser，免 Node。

## Agent 帳號與額度

agent 跑在 **bridge（本機 Node 程序）**，它 spawn 你電腦上的 `claude` / `codex` / `antigravity` **CLI** 當子程序。
用的是**各 CLI 在本機的登入帳號與額度**，**與瀏覽器登入的 AI（claude.ai / ChatGPT 網頁）無關**：

| Agent | 帳號 / 額度來源 | 憑證位置 |
|---|---|---|
| Claude | 終端機 `claude` 登入的帳號（訂閱或 `ANTHROPIC_API_KEY`） | `~/.claude` |
| Codex | `codex` 登入的 OpenAI 帳號 | `~/.codex` |
| Antigravity | `antigravity` / `agy` CLI 的登入帳號 | `~/.antigravity` |

- 「執行測試 / 匯出 pytest」消耗的是上表 CLI 帳號的額度（例如 `session limit` 是該帳號的上限）。
- Notion 讀取/寫回用的是 Options 頁的 Notion Token，與 agent 帳號無關。
- 在終端機執行 `claude` / `codex` / `antigravity` 即可查看或切換登入；bridge 直接沿用其當下登入。

## Notion 設定（Phase 1）

1. 到 notion.so/my-integrations 建立 internal integration，取得 token。
2. 把測試案例頁面「分享」給該 integration。
3. extension Options 頁填入 token 與測試案例頁面 ID（例 `380b399ad8b580d0b87fe2c04fee33d1`）。
4. 頁面中每個含 `TC-xx` 的 heading 會被解析成一個測試案例（目的 / 前置條件 / 測試步驟 / 確認項目）。

## 快速開始

### 1. 啟動 bridge

```bash
cd bridge
npm install
npm run dev            # 預設 listen ws/http://localhost:8787
```

#### bridge 連線時自動啟動，免每次手動 `npm run dev`

目標：side panel 按「連線」時 bridge 沒開就自動拉起來（背景常駐），平常不用手動 `npm run dev`。
這需要安裝一次 **Native Messaging host**（Chrome 規定：此 manifest 必須由 extension 外部寫入系統目錄，沙箱不能自己寫）。

**正常情況：完全自動 —— 你只要 `npm install`。**

```bash
cd bridge && npm install      # postinstall 會自動安裝 native host（依 extension/ 路徑推算 extension ID）
```

安裝時會印出推算的 extension ID，例如：
```
extension id = bclmhhlnfnimllooobmohlnnicholnbd
✓ 已安裝: .../Google/Chrome/NativeMessagingHosts/com.jt_testing.bridge_launcher.json
```

**extension ID 已固定**

`extension/manifest.json` 內含 `key`（公鑰），Chrome 會據此給一個**固定 ID `gbodpgijbhekommdppfcgebacbpmedcj`**，與載入路徑、機器無關。install 會自動用此固定 ID，所以**不會再有 ID 不一致問題**。
（私鑰在 `.keys/extension_key.pem`，請保密、勿進版控；未來打包 .crx / .pkg 會用到。）

**首次安裝後務必做一次**：到 `chrome://extensions` **重新載入擴充**——載入後 ID 會變成上面的固定 ID（與 native host 已設定的一致）。因 ID 變更，Options 的 Notion Token 等設定需**重新輸入一次**。之後關掉重開 side panel。

之後流程：開 side panel → 按「連線」→ bridge 沒跑會自動啟動。
搬移專案或更換 extension id 後，重跑 `npm install` 或 `npm run setup-native-host` 即可。

- **連線**：bridge 沒跑會自動啟動（`npm start`）。
- **停止 bridge**：side panel 連線列的紅色「停止 bridge」鈕，會關閉背景 bridge 程序。
- 改了 bridge 程式碼後：按「停止 bridge」→「連線」即以新碼重啟（自動啟動用 `npm start`，非 watch）。

設定（環境變數，皆可選）：

| 變數 | 預設 | 說明 |
|---|---|---|
| `AT_REPO_PATH` | `/Users/jefflin/gitProject/automatic-testing` | automatic-testing 本地 clone（也可在 extension Options 頁設定／用「選取…」挑資料夾） |

> Options 頁的「選取…」資料夾選擇器由 bridge 叫出原生對話框，**需 bridge 先在執行中**（先在 side panel 按「連線」啟動）。設定後按「停止 bridge」→「連線」套用。
| `BRIDGE_PORT` | `8787` | WS / HTTP port |
| `CDP_PROXY_PORT` | `9333` | 給 chrome-devtools-mcp 的 `--browser-url`（Phase 2） |
| `DEFAULT_AGENT` | `claude` | 預設 agent runtime |

金鑰（`NOTION_API_KEY` / `ANTHROPIC_API_KEY` 等）自 AT repo 的 `.env` 載入，不另存。

健康檢查：`curl http://localhost:8787/health`

### 2. 載入 extension

1. Chrome → `chrome://extensions` → 開啟「開發人員模式」
2. 「載入未封裝項目」→ 選 `extension/`
3. 點工具列圖示開啟 side panel，按「連線」（預設已自動連 `ws://localhost:8787`）
4. 按「讀取案例」列出 Notion 測試案例

## 進度（依 plan 分階段）

- [x] Phase 0 — Scaffold + WS 連線 + side panel
- [x] Phase 1 — extension 端直讀 Notion 並解析 TC（已對真實頁面驗證：12 個 TC）
- [x] Phase 2 — 接管當前分頁 + Claude adapter 即時驅動（已端到端驗證：agent 選取當前分頁、未開新分頁、輸出 PASS verdict）
- [x] Phase 3 — 每測項 `.gif`（Page.screencast + ffmpeg，已驗證產出有效 GIF）
- [x] Phase 4 — Notion 友善 markdown 結果 + 寫回「AI測試報告結果」+ bridge `/artifacts` 預覽
- [x] Phase 5 — 匯出 pytest 到 AT clone（agent 依 CLAUDE.md 生成）+ 本地 commit（不 push，已驗證 git 邏輯）
- [x] Phase 6 — 可插拔 agent：Claude（完整驗證）/ Codex / Antigravity（已 wired，UI 依實際安裝啟用）

## 完整工作流程

0. **一次性**：`cd bridge && npm install`（會自動裝好 native host 自動啟動）+ 載入 `extension/` 後重新載入一次擴充。
1. **設定** Notion token + 測試頁面 ID（Options 頁）。開 side panel 按「連線」→ bridge 沒開會自動啟動。
2. **讀取案例** → 勾選要跑的 TC。
3. 以 remote-debugging 啟動 Chrome、載入本 extension、開要測的分頁。
4. **接管當前分頁執行** → agent 即時驅動、log 串流、每測項產出 `.gif` + markdown，結果卡可預覽 gif / 複製 markdown / 寫回 Notion。
5. **匯出 pytest**（選 product）→ agent 依 AT `CLAUDE.md` 生成測試檔到本地 clone。
6. **建立本地 commit**（指定分支）→ 不自動 push；確認後按 **Push**。

> Agent 後端可插拔：Claude 為完整驗證路徑；Codex / Antigravity 已接好介面，瀏覽器驅動整合屬實驗性（各自 MCP 設定方式不同）。

## 執行測試（Phase 2）

「接管當前分頁」透過 **remote debugging** 機制（最穩、不需 CDP relay）：

1. **一鍵啟動（推薦）**：side panel 按「**啟動測試用 Chrome**」。bridge 會自動以
   `--remote-debugging-port` 啟動 Chrome、`--load-extension` 載入本 extension、開好分頁。
   （或手動：`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/jt-chrome`）
2. 在啟動的 Chrome 開要測的分頁 → side panel 勾選 TC → 選 Agent（Claude）→「接管當前分頁執行」。
3. bridge 會先檢查 CDP 可連，再請 agent 用 `list_pages`/`select_page` 鎖定你的當前分頁逐步執行，事件即時串回 side panel。

> Chrome 路徑 / profile 可用環境變數 `CHROME_BINARY`、`CHROME_USER_DATA_DIR` 覆寫。

### 接管當前分頁（attach 模式，實驗性）

side panel 模式選「接管當前分頁」→ 按「接管當前分頁」：extension 用 `chrome.debugger`
attach 你日常 Chrome 的當前分頁，CDP 經 `/cdp-relay` 轉發到 bridge 的 CDP proxy(9333)，
讓 chrome-devtools-mcp 驅動該分頁，**免另開 Chrome**。

實作組件：`extension/background.js`（debugger relay）、`bridge/src/cdp-proxy.ts`（對 puppeteer
模擬單一分頁的瀏覽器端點）、`bridge/src/attach.ts`。

**已驗證**：CDP proxy 握手、`list_pages` 取得當前分頁、session 指令轉發（含
`Runtime.enable`/`executionContextCreated` 事件 + `Runtime.evaluate`）在隔離測試全數通過。
**已知限制**：live chrome-devtools-mcp 的 `evaluate_script`/`take_snapshot` 偶發 timeout
（puppeteer 內部 auto-attach 與本 proxy 合成 Target 事件的時序競態），仍需再調校。
attach 模式目前暫不錄影。**正式使用請優先用 remote-debugging 模式。**

> 註：原規劃的 `chrome.debugger` attach + CDP relay 仍保留為未來選項；remote-debugging 機制已能讓 agent 驅動「使用者實際的當前分頁」（不另開分頁）。
