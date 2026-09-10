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

import { google } from "@/lib/google/apis";
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
      // A WIDER NET (v33.32). Two days and 25 messages was a guess, and a
      // busy week of newsletters could push a bounce out of both — a missed
      // bounce means an IR sits with no invite until the call doesn't happen.
      q: "from:(mailer-daemon OR postmaster) newer_than:7d",
      maxResults: 60,
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
  /** ONLY WHAT WE ACTUALLY READ IS "SEEN" (v33.32). Every listed id used to be
   *  marked seen, including ones whose fetch had just failed — one transient
   *  Gmail error and that bounce was never parsed again, silently, forever. */
  const parsed: string[] = [];
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
      parsed.push(id);
    } catch (e) {
      console.error("[bounces] gmail get failed:", e);
    }
  }

  // remember what was parsed (newest first, deduped, capped) — anything older
  // than the query window has aged out of the search anyway
  if (parsed.length > 0)
    await db()
      .from("app_settings")
      .upsert({
        key: SEEN_KEY,
        value: JSON.stringify([...new Set([...parsed, ...seen])].slice(0, 300)),
      });

  if (bounced.size === 0) return { checked: fresh.length, flagged: 0 };

  const { data: calls } = await db()
    .from("ir_calls")
    .select(
      "id, booker_email, booker_name, booker_phone, partner_lc_name, member_id, called_at"
    )
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
    if (c.member_id) await alertHost(c as BouncedCall);
  }
  if (flagged > 0) console.log(`[bounces] flagged ${flagged} bounced IR email(s)`);
  return { checked: fresh.length, flagged };
}

interface BouncedCall {
  id: string;
  booker_email: string | null;
  booker_name: string | null;
  booker_phone: string | null;
  partner_lc_name: string;
  member_id: string | null;
  called_at: string;
}

/** TELL THE HOST, LOUDLY (v33.32). A bell was the only signal, and bells get
 *  scrolled past: the call still had no invite three days later. Now it is a
 *  bell AND an email carrying the IR's WhatsApp link — the one channel we know
 *  still reaches them — because fixing this needs a human to go and ask. */
async function alertHost(c: BouncedCall): Promise<void> {
  if (!c.member_id) return;
  const bad = c.booker_email ?? "their address";
  try {
    const { notifyMembers } = await import("./notify");
    await notifyMembers(
      [c.member_id],
      "info",
      `⚠️ ${c.booker_name ?? "The IR"}'s email bounced — ${c.partner_lc_name}`,
      `The invite to ${bad} couldn't be delivered (the address doesn't exist). WhatsApp them for the right one, then open the call on Consideration → Fix the email — the invite is re-sent automatically.`,
      null,
      "/consideration"
    );
  } catch (e) {
    console.error("[bounces] notify failed:", e);
  }
  try {
    const [{ cairoWhenLabel }, { irEmailBouncedEmail }, { sendEmail }] = await Promise.all([
      import("./data"),
      import("@/lib/email/templates"),
      import("@/lib/google/gmail"),
    ]);
    // ONE RETRY, AND EVERY EARLY RETURN SAYS SO (v33.40, the Dai case): the
    // host lookup failed transiently once, the old `if (!host) return` ate it
    // without a log, and the alert email simply never existed — while the run
    // log read like a success. A silent return here is indistinguishable from
    // "emailed", so nothing stays silent.
    let host: { name: string; email: string | null; fallback_email: string | null } | null =
      null;
    for (let attempt = 0; attempt < 2 && !host; attempt++) {
      const { data, error } = await db()
        .from("members")
        .select("name, email, fallback_email")
        .eq("id", c.member_id)
        .maybeSingle<{ name: string; email: string | null; fallback_email: string | null }>();
      if (error) {
        console.error("[bounces] host lookup failed:", error.message);
        continue;
      }
      host = data;
      if (!host) break; // a real no-row answer — retrying won't invent one
    }
    if (!host) {
      console.error(`[bounces] host row unreachable — alert email skipped for call ${c.id}`);
      return;
    }
    // the AIESEC address, else the backup Gmail (v33.29) — a host with no
    // mailbox yet is exactly the kind who most needs telling
    const to = host.email ?? host.fallback_email ?? null;
    if (!to) {
      // NO INBOX AT ALL → the consideration leadership hears it instead
      // (v33.40): the bell alone gets scrolled past, which is why the email
      // exists — someone with a mailbox has to carry the message
      console.warn(`[bounces] host ${host.name} has no email — alerting the leads`);
      const { data: leads } = await db()
        .from("members")
        .select("email, fallback_email, role, functions, sub_functions")
        .eq("is_active", true);
      const leadEmails = (leads ?? [])
        .filter(
          (m) =>
            ["LCVP", "Director"].includes(m.role as string) &&
            [...((m.functions as string[]) ?? []), ...((m.sub_functions as string[]) ?? [])]
              .some((f) => ["Consideration", "IGV", "IGT"].includes(f))
        )
        .map((m) => (m.email as string | null) ?? (m.fallback_email as string | null))
        .filter((e): e is string => !!e);
      if (leadEmails.length > 0) {
        const { irEmailBouncedEmail: tmpl } = await import("@/lib/email/templates");
        const { env } = await import("@/lib/env");
        const m2 = tmpl({
          memberFirstName: "team",
          bookerName: c.booker_name,
          partnerLc: c.partner_lc_name,
          badEmail: bad,
          whenLabel: cairoWhenLabel(c.called_at),
          bookerPhone: c.booker_phone,
          whatsappUrl: null,
          considerationUrl: `${env.appUrl}/consideration`,
        });
        await sendEmail({
          to: leadEmails,
          subject: `${m2.subject} — host ${host.name} has no email on file`,
          html: m2.html,
        });
        console.log(`[bounces] leads emailed for call ${c.id} (host has no inbox)`);
      }
      return;
    }
    const { env } = await import("@/lib/env");
    const digits = (c.booker_phone ?? "").replace(/[^\d]/g, "");
    const mail = irEmailBouncedEmail({
      memberFirstName: host.name.split(" ")[0],
      bookerName: c.booker_name,
      partnerLc: c.partner_lc_name,
      badEmail: bad,
      whenLabel: cairoWhenLabel(c.called_at),
      bookerPhone: c.booker_phone,
      whatsappUrl: digits
        ? `https://wa.me/${digits}?text=${encodeURIComponent(
            `Hi${c.booker_name ? ` ${c.booker_name}` : ""}! This is ${host.name} from AIESEC in Alexandria. The invite for our call bounced back from ${bad} — could you send me your correct email so I can re-send it?`
          )}`
        : null,
      considerationUrl: `${env.appUrl}/consideration`,
    });
    await sendEmail({ to: [to], subject: mail.subject, html: mail.html });
    console.log(`[bounces] host ${host.name} emailed at ${to} for call ${c.id}`);
  } catch (e) {
    console.error("[bounces] host email failed:", e);
  }
}
