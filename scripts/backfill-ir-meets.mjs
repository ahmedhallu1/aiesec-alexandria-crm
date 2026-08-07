/* eslint-disable */
/**
 * ONE-OFF (v33.19.2): give the IR calls booked BEFORE the mailbox fallback
 * their Meet link and invite.
 *
 * Members who signed in with a password have no Google grant, so bookIrCall
 * could not create an event on their calendar — the IR booked, got a
 * confirmation email, and no calendar invite or Meet room. Those bookings are
 * still in the future, so the fix is to create the event now on the IM mailbox
 * calendar exactly as a fresh booking would, and record it the same way
 * (event_calendar='mailbox') so cancel/reschedule keep working.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/backfill-ir-meets.mjs [--dry]
 *
 * Sends real calendar invites to external IRs — run once, read the dry run first.
 */
import "./_node-compat.mjs";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const DRY = process.argv.includes("--dry");
const { db } = await import("../src/lib/supabase.ts");
const { createIrCallEventOnMailbox } = await import("../src/lib/google/calendar.ts");

const { data: calls, error } = await db()
  .from("ir_calls")
  .select("id, member_id, member_name, partner_lc_name, called_at, duration_minutes, booker_name, booker_email, booker_phone")
  .eq("status", "scheduled")
  .is("calendar_event_id", null)
  .gt("called_at", new Date().toISOString())
  .order("called_at");
if (error) throw new Error(error.message);

console.log(`${calls.length} future call(s) with no calendar event${DRY ? " (DRY RUN)" : ""}\n`);

let done = 0;
for (const c of calls ?? []) {
  const { data: owner } = await db()
    .from("members").select("email").eq("id", c.member_id).maybeSingle();
  const when = new Date(c.called_at);
  console.log(
    `• ${c.partner_lc_name} · ${when.toISOString()} · with ${c.member_name} · IR ${c.booker_email}`
  );
  if (DRY) continue;
  const ev = await createIrCallEventOnMailbox({
    partnerLc: c.partner_lc_name,
    start: when,
    minutes: c.duration_minutes || 30,
    attendeeEmail: c.booker_email,
    ownerEmail: owner?.email ?? null,
    guestsCanInvite: true,
    description:
      `AIESEC IR call.\nPartner LC: ${c.partner_lc_name}` +
      `${c.booker_name ? `\nBooked by: ${c.booker_name}` : ""}` +
      `${c.booker_phone ? ` · ${c.booker_phone}` : ""} <${c.booker_email}>` +
      `\nHost: ${c.member_name}, AIESEC in Alexandria.`,
  });
  if (!ev) {
    console.log("   ↳ FAILED (mailbox calendar unavailable)");
    continue;
  }
  const { error: upErr } = await db()
    .from("ir_calls")
    .update({ calendar_event_id: ev.id, meet_link: ev.meetLink, event_calendar: "mailbox" })
    .eq("id", c.id);
  if (upErr) console.log("   ↳ event made but DB update failed:", upErr.message);
  else {
    done += 1;
    console.log(`   ↳ invited · ${ev.meetLink ?? "(no meet link returned)"}`);
  }
}
console.log(`\n${DRY ? "would backfill" : "backfilled"} ${DRY ? (calls ?? []).length : done} call(s)`);
process.exit(0);
