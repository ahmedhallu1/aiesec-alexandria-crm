/* eslint-disable */
/**
 * Node < 22 has no global WebSocket, and @supabase/supabase-js constructs a
 * RealtimeClient inside createClient() — so `db()` throws before a single
 * query runs. CI pins Node 22; this keeps the scripts runnable on 20 too.
 * Import it BEFORE anything that touches src/lib/supabase.
 */
if (typeof globalThis.WebSocket === "undefined") {
  try {
    const { default: ws } = await import("ws");
    globalThis.WebSocket = ws;
  } catch {
    console.warn("[scripts] no global WebSocket and `ws` is not installed — Supabase may fail");
  }
}
