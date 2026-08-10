/* eslint-disable */
/**
 * ONE-OFF (v33.32): chase the IR calls that were BOOKED, whose time has
 * PASSED, and that nobody has reported on.
 *
 * WHY. A call in that state is neither "upcoming" nor "done": it counted for
 * nothing and nothing chased it, so sixteen of them had quietly piled up
 * across seven members. v33.32 makes them visible in the app (the ⏰ chip, the
 * banner, the "Waiting to be reported" KPI) — this tells the people holding
 * them, once, so the backlog gets cleared rather than merely displayed.
 *
 * ONE MESSAGE PER HOST, not per call: the answer is one visit to the tab.
 *
 * Notifications are inserted DIRECTLY rather than through notifyMembers,
 * which reads the sandbox cookie and so needs a request context.
 *
 * Members with no @aiesec.net and no backup Gmail get the in-app bell only —
 * they are listed in the output, because "notified" must not quietly mean
 * "notified some of them".
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/nag-overdue-ir-calls.mjs [--dry]
 */
import "./_node-compat.mjs";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const DRY = process.argv.includes("--dry");
const { db } = await import("../src/lib/supabase.ts");
const { cairoWhenLabel } = await import("../src/server/data.ts");
const { irCallsOverdueEmail } = await import("../src/lib/email/templates.ts");
const { sendEmail } = await import("../src/lib/google/gmail.ts");
const { env } = await import("../src/lib/env.ts");

const { data: calls, error } = await db()
  .from("ir_calls")
  .select("id, member_id, member_name, partner_lc_name, called_at, booker_name")
  .eq("status", "scheduled")
  .lt("called_at", new Date().toISOString())
  .order("called_at");
if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}
if (!calls?.length) {
  console.log("Nothing overdue — every booked call has been reported on. 🎉");
  process.exit(0);
}

// group by HOST
const byHost = new Map();
for (const c of calls) {
  if (!c.member_id) continue; // a call with no owner has nobody to chase
  const list = byHost.get(c.member_id) ?? [];
  list.push(c);
  byHost.set(c.member_id, list);
}

const { data: members } = await db()
  .from("members")
  .select("id, name, email, fallback_email, is_active")
  .in("id", [...byHost.keys()]);
const memberById = new Map((members ?? []).map((m) => [m.id, m]));

let belled = 0;
let mailed = 0;
const noInbox = [];
const skipped = [];

for (const [memberId, list] of byHost) {
  const m = memberById.get(memberId);
  if (!m || !m.is_active) {
    skipped.push(`${list[0].member_name} (inactive or missing) — ${list.length} call(s)`);
    continue;
  }
  const n = list.length;
  const lines = list.map(
    (c) => `${c.partner_lc_name} — ${cairoWhenLabel(c.called_at)}`
  );
  const title = `⏰ ${n} IR call${n === 1 ? "" : "s"} waiting for your report`;
  const body =
    `${n === 1 ? "This call has" : "These calls have"} passed with nothing recorded: ` +
    `${lines.join(" · ")}. Open it on Consideration and either fill the in-call ` +
    `notes (that completes it) or cancel it with a reason.`;

  console.log(`\n${m.name} — ${n} overdue`);
  for (const l of lines) console.log(`   · ${l}`);
  console.log(`   inbox: ${m.email ?? m.fallback_email ?? "— none (bell only)"}`);
  if (DRY) continue;

  const { error: nErr } = await db().from("notifications").insert({
    member_id: m.id,
    kind: "info",
    title,
    body,
    link: "/consideration",
  });
  if (nErr) console.error(`   ! bell failed: ${nErr.message}`);
  else belled++;

  const to = m.email ?? m.fallback_email ?? null;
  if (!to) {
    noInbox.push(`${m.name} (${n})`);
    continue;
  }
  try {
    const mail = irCallsOverdueEmail({
      memberFirstName: m.name.split(" ")[0] || m.name,
      calls: list.map((c) => ({
        partnerLc: c.partner_lc_name,
        whenLabel: cairoWhenLabel(c.called_at),
        bookerName: c.booker_name,
      })),
      considerationUrl: `${env.appUrl}/consideration`,
    });
    await sendEmail({ to: [to], subject: mail.subject, html: mail.html });
    mailed++;
  } catch (e) {
    console.error(`   ! email failed: ${e?.message ?? e}`);
  }
}

console.log(
  `\n${DRY ? "[dry] " : ""}${calls.length} overdue call(s) · ${byHost.size} host(s)` +
    `${DRY ? "" : ` · ${belled} belled · ${mailed} emailed`}`
);
if (noInbox.length)
  console.log(`bell only (no AIESEC mail, no backup Gmail): ${noInbox.join(", ")}`);
if (skipped.length) console.log(`skipped: ${skipped.join(", ")}`);
