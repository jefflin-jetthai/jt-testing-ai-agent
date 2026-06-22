/**
 * Extension <-> Bridge 的 WebSocket 訊息協定。
 *
 * 一律 JSON：{ id?, type, payload }
 * - request：extension → bridge，帶 id，期待對應 response
 * - response：bridge → extension，帶相同 id
 * - event：bridge → extension，無 id（單向串流，如 agent log、測試進度）
 */
export {};
//# sourceMappingURL=protocol.js.map