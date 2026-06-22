/**
 * 「接管當前分頁」(chrome.debugger) 模式的共用狀態：
 * 單一 TabRelay（橋接 extension 的 debugger）+ CdpProxy（對 puppeteer 模擬瀏覽器）。
 */
import { CDP_PROXY_PORT } from "./config.js";
import { CdpProxy, TabRelay } from "./cdp-proxy.js";
export const tabRelay = new TabRelay();
let proxy = null;
/** 啟動 CDP proxy（首次連線時）。 */
export function ensureCdpProxy() {
    if (!proxy) {
        proxy = new CdpProxy(CDP_PROXY_PORT, tabRelay);
        proxy.start();
    }
}
export function isRelayConnected() {
    return tabRelay.connected;
}
/** 給 chrome-devtools-mcp 用的 proxy browser-url。 */
export function attachBrowserUrl() {
    return `http://127.0.0.1:${CDP_PROXY_PORT}`;
}
//# sourceMappingURL=attach.js.map