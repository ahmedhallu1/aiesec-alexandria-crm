import "server-only";

/** IR EMAIL BOUNCE WATCHER (v33.29 part 2).
 *
 *  The domain check at booking time (`emailDomainIssue`) catches dead DOMAINS,
 *  but a real domain with a wrong USER (the Visakhapatnam case — a reversed
 *  name at a valid gmail.com) only reveals itself when the mail server sends
 *  the bounce back. All confirmation emails and mailbox-hosted invites go out
 *  from the IM mailbox, so the bounces land there: this scans that inbox for
 *  mailer-daemon reports, extracts the failed recipients (RFC 3464
 *  Final-Recipient / X-Failed-Recipients), and flags any SCHEDULED IR call
 *  whose booker_email matches — bell to the host, badge on the call, and the
 *  "Fix the email" action closes the loop. Runs on the 15-minute
 *  visit-followups cron: one Gmail list call per tick, message bodies fetched
 *  only for reports not seen before. */

import { google } from "googleapis";
import { env, requireEnv } from "@/lib/env";
import { db } from "@/lib/supabase";

const SEEN_KEY = "bounce:seen-messages";

export async function checkIrEmailBounces(): Promise<{ checked: number; flagged: number }> {
  const missing = requireEnv("googleClientId", "googleClientSecret", "gmailRefreshToken");
  if (missing) return { checked: 0, flagged: 0 };
  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: env.gmailRefreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  let ids: string[] = [];
  try {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: "from:(mailer-daemon OR postmaster) newer_than:2d",
      maxResults: 25,
    });
    ids = (res.data.messages ?? []).map((m) => m.id ?? "").filter(Boolean);
  } catch (e) {
    console.error("[bounces] gmail list failed:", e);
    return { checked: 0, flagged: 0 };
  }
  if (ids.length === 0) return { checked: 0, flagged: 0 };

  const { data: seenRow } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", SEEN_KEY)
    .maybeSingle<{ value: string }>();
  let seen: string[] = [];
  try {
    const parsed = JSON.parse(seenRow?.value ?? "[]");
    if (Array.isArray(parsed)) seen = parsed.filter((x) => typeof x === "string");
  } catch {
    seen = [];
  }
  const seenSet = new Set(seen);
  const fresh = ids.filter((id) => !seenSet.has(id));
  if (fresh.length === 0) return { checked: 0, flagged: 0 };

  const bounced = new Set<string>();
  for (const id of fresh) {
    try {
      const msg = await gmail.users.messages.get({ userId: "me", id, format: "raw" });
      const raw = Buffer.from(msg.data.raw ?? "", "base64").toString("utf8");
      for (const m of raw.matchAll(
        /(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>;,]+@[^\s>;,]+)>?/gi
      ))
        bounced.add(m[1].toLowerCase());
      for (const m of raw.matchAll(/X-Failed-Recipients:\s*([^\r\n]+)/gi))
        for (const part of m[1].split(",")) {
          const addr = part.trim().toLowerCase();
          if (addr.includes("@")) bounced.add(addr);
        }
    } catch (e) {
      console.error("[bounces] gmail get failed:", e);
    }
  }

  // remember what was parsed (newest first, capped) — the 2-day query window
  // means anything older than the cap has aged out of the query anyway
  await db()
    .from("app_settings")
    .upsert({ key: SEEN_KEY, value: JSON.stringify([...ids, ...seen].slice(0, 100)) });

  if (bounced.size === 0) return { checked: fresh.length, flagged: 0 };

  const { data: calls } = await db()
    .from("ir_calls")
    .select("id, booker_email, booker_name, partner_lc_name, member_id")
    .eq("status", "scheduled")
    .is("email_bounced_at", null)
    .not("booker_email", "is", null);
  const hits = (calls ?? []).filter((c) =>
    bounced.has(String(c.booker_email).toLowerCase())
  );

  let flagged = 0;
  for (const c of hits) {
    const { error } = await db()
      .from("ir_calls")
      .update({ email_bounced_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) {
      console.error("[bounces] flag failed:", error.message);
      continue;
    }
    flagged++;
    if (c.member_id) {
      try {
        const { notifyMembers } = await import("./notify");
        await notifyMembers(
          [c.member_id as string],
          "info",
          `⚠️ ${c.booker_name ?? "The IR"}'s email bounced — ${c.partner_lc_name}`,
          `The invite to ${c.booker_email} couldn't be delivered (the address doesn't exist). Open the call on Consideration and fix the email so the Meet invite reaches them.`,
          null,
          "/consideration"
        );
      } catch (e) {
        console.error("[bounces] notify failed:", e);
      }
    }
  }
  if (flagged > 0) console.log(`[bounces] flagged ${flagged} bounced IR email(s)`);
  return { checked: fresh.length, flagged };
}
