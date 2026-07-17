#!/usr/bin/env node
/**
 * Mint (or re-mint) the IM mailbox refresh token for Sodio.
 *
 * ONE token powers BOTH the transactional emails AND the shared "Sodio — LC
 * Visits" calendar, so it must carry both scopes:
 *   - https://mail.google.com/                    (send/read mail)
 *   - https://www.googleapis.com/auth/calendar    (shared visits calendar)
 *
 * Usage (from the repo root):
 *   node scripts/mint-mailbox-token.mjs
 *
 * It reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from .env.local (or the
 * environment), opens Google's consent screen, catches the redirect on a tiny
 * local server, and prints the refresh token. Sign in as the IM mailbox
 * (ahmedhallul@aiesec.net) and approve EVERY permission.
 *
 * Requirements:
 *   - The redirect URI below must be an "Authorized redirect URI" on the Web
 *     OAuth client (http://localhost:3000 is registered per SETUP.md §2b).
 *     Override with REDIRECT_URI=... if yours differs.
 *   - Port must be free — stop `npm run dev` first if it uses 3000.
 *
 * The token is only PRINTED — this script never writes it anywhere. Paste it
 * into Vercel (Production env) and .env.local yourself, then redeploy.
 */

import http from "node:http";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/calendar",
];
const REDIRECT_URI = process.env.REDIRECT_URI || "http://localhost:3000";

// ---- load client id/secret from env or .env.local -------------------------
function fromEnvLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).replace(/^"|"$/g, "").trim() : "";
  } catch {
    return "";
  }
}

const CLIENT_ID = fromEnvLocal("AUTH_GOOGLE_ID");
const CLIENT_SECRET = fromEnvLocal("AUTH_GOOGLE_SECRET");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "✖ AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET not found in .env.local or the environment."
  );
  process.exit(1);
}

const redirect = new URL(REDIRECT_URI);
const port = Number(redirect.port || 80);

// ---- build the consent URL ------------------------------------------------
const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force a fresh refresh_token every time
  }).toString();

// ---- catch the redirect, exchange the code --------------------------------
async function exchange(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  return res.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");

  if (err) {
    res.end(`Authorization failed: ${err}. You can close this tab.`);
    console.error(`\n✖ Google returned: ${err}`);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.statusCode = 404;
    res.end("Waiting for the Google redirect…");
    return;
  }

  const tokens = await exchange(code);
  if (!tokens.refresh_token) {
    res.end("No refresh token returned — see the terminal. You can close this tab.");
    console.error(
      "\n✖ No refresh_token in the response:",
      JSON.stringify(tokens, null, 2),
      "\n  (If you've authorized before, revoke Sodio at https://myaccount.google.com/permissions and re-run.)"
    );
    server.close();
    process.exit(1);
  }

  res.end("✅ Done! Copy the refresh token from your terminal. You can close this tab.");
  console.log("\n────────────────────────────────────────────────────────");
  console.log("✅ GMAIL_REFRESH_TOKEN (scopes: gmail + calendar):\n");
  console.log(tokens.refresh_token);
  console.log("\n────────────────────────────────────────────────────────");
  console.log("Next: paste it into Vercel (Production env) AND .env.local, then redeploy.");
  console.log("Verify on /admin → the 'Shared visits calendar' check turns green.\n");
  server.close();
  process.exit(0);
});

server.listen(port, () => {
  console.log(`\nMinting the Sodio mailbox token (scopes: ${SCOPES.join(", ")})`);
  console.log(`Listening for the redirect on ${REDIRECT_URI}\n`);
  console.log("1) A browser will open Google's consent screen.");
  console.log("2) Sign in as the IM mailbox (ahmedhallul@aiesec.net) and APPROVE every permission.\n");
  console.log("If it doesn't open, paste this URL into your browser:\n");
  console.log(authUrl + "\n");
  // best-effort auto-open (mac/linux/win)
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(opener, [authUrl], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    /* the printed URL is the fallback */
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(
      `\n✖ Port ${port} is busy — stop your dev server (npm run dev) and re-run, ` +
        `or set REDIRECT_URI to another registered redirect URI.`
    );
  } else {
    console.error("\n✖ Server error:", e.message);
  }
  process.exit(1);
});
