/* eslint-disable */
/**
 * ONE-OFF (v33.22): write to every IR with an UPCOMING call and tell them,
 * in their own local time, exactly when it is.
 *
 * WHY. Until v33.22 the public booking page rendered Cairo time with a
 * one-line footnote. The bookings themselves are correct — a call is stored
 * as a UTC instant and the Google invite has always shown each attendee their
 * own zone — but an IR who read "6:00 PM" as 6 PM at home is out by the
 * offset. So this is a CONFIRMATION, not an apology: same call, same moment,
 * written in their words, with the reschedule link in case seeing it in their
 * own clock changes their mind.
 *
 * The zone comes from `bookerZoneFor`: the zone recorded at booking (none of
 * these have one — they predate the column), then the partner LC's zone, then
 * the LC's country. A call whose zone can't be worked out is SKIPPED and
 * printed, because a confident wrong time is worse than no email.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/ir-timezone-confirmations.mjs [--dry]
 *
 * Sends real email to external IRs — read the dry run first.
 */
import "./_node-compat.mjs";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const DRY = process.argv.includes("--dry");
const { db } = await import("../src/lib/supabase.ts");
const { bookerZoneFor, cairoWhenLabel } = await import("../src/server/data.ts");
const { whenLabelInZone } = await import("../src/lib/timezones.ts");
const { irTimeZoneConfirmEmail } = await import("../src/lib/email/templates.ts");
const { sendEmail } = await import("../src/lib/google/gmail.ts");
const { env } = await import("../src/lib/env.ts");

const { data: calls, error } = await db()
  .from("ir_calls")
  .select(
    "id, member_name, partner_lc_id, partner_lc_name, called_at, booker_name, booker_email, booker_tz, meet_link, manage_token"
  )
  .eq("status", "scheduled")
  .gt("called_at", new Date().toISOString())
  .order("called_at");
if (error) throw new Error(error.message);

console.log(`${calls.length} upcoming call(s)${DRY ? " — DRY RUN, nothing sent" : ""}\n`);

let sent = 0;
const skipped = [];
for (const c of calls ?? []) {
  if (!c.booker_email) {
    skipped.push(`${c.partner_lc_name}: no IR email on the booking`);
    continue;
  }
  const zone = await bookerZoneFor(c.booker_tz, c.partner_lc_id);
  if (!zone) {
    skipped.push(`${c.partner_lc_name} <${c.booker_email}>: no time zone and no country to infer one`);
    continue;
  }
  const theirLabel = whenLabelInZone(c.called_at, zone);
  const cairoLabel = cairoWhenLabel(c.called_at);
  console.log(`• ${c.partner_lc_name} <${c.booker_email}>`);
  console.log(`   ${cairoLabel}  →  ${theirLabel}`);
  if (DRY) continue;
  if (!c.manage_token) {
    skipped.push(`${c.partner_lc_name}: no manage token (booked before the manage link existed)`);
    continue;
  }
  const mail = irTimeZoneConfirmEmail({
    bookerName: c.booker_name,
    memberName: c.member_name,
    partnerLc: c.partner_lc_name,
    theirLabel,
    cairoLabel,
    meetLink: c.meet_link,
    manageUrl: `${env.appUrl}/book/manage/${c.manage_token}`,
  });
  try {
    await sendEmail({ to: [c.booker_email], subject: mail.subject, html: mail.html });
    sent += 1;
    console.log("   ↳ sent");
  } catch (e) {
    skipped.push(`${c.partner_lc_name}: send failed — ${e?.message ?? e}`);
    console.log("   ↳ FAILED:", e?.message ?? e);
  }
  // remember the zone we worked out, so the app agrees with this email
  if (!c.booker_tz)
    await db().from("ir_calls").update({ booker_tz: zone }).eq("id", c.id);
}

console.log(`\n${DRY ? "would send" : "sent"} ${DRY ? (calls ?? []).length - skipped.length : sent}`);
if (skipped.length) {
  console.log(`\nSKIPPED (${skipped.length}) — handle these by hand:`);
  for (const s of skipped) console.log(`  · ${s}`);
}
process.exit(0);
