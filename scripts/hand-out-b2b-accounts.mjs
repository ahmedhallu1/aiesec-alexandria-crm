/**
 * ONE-OFF (v33.52) — hand 50 unassigned market-research names to the B2B/BD
 * crew, shuffled, and tell them.
 *
 * THE RULES, as asked for:
 *   · only accounts nobody holds, still in process, NOT test, and carrying a
 *     PHONE NUMBER — a name with no way to reach it is not work
 *   · shuffled, then dealt round-robin to the crew's Members + MMs (the
 *     Director is not a raiser)
 *   · the account is MARKED B2B, because it now belongs to a B2B raiser (the
 *     same rule every cross-function hand-over follows since v33.18). B2B and
 *     IGV/IGT share a name world, so no unique-name collision is possible
 *   · every hand-over is written to the audit log under the admin's name, and
 *     each person gets ONE bell + one email listing what landed on their plate
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/hand-out-b2b-accounts.mjs --dry
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/hand-out-b2b-accounts.mjs --go
 */
import "./_node-compat.mjs";

const DRY = !process.argv.includes("--go");
const TOTAL = 50;

const { db } = await import("../src/lib/supabase.ts");
const { env } = await import("../src/lib/env.ts");

// ---- who is getting them -------------------------------------------------
const { data: crew } = await db()
  .from("members")
  .select("id, name, email, role, functions, sub_functions")
  .eq("is_active", true);
const isB2b = (m) =>
  ["B2B", "BD"].some(
    (f) => (m.functions ?? []).includes(f) || (m.sub_functions ?? []).includes(f)
  );
// Members + MMs (Team Leaders / Coordinators). VPs and Directors steer.
const takers = (crew ?? [])
  .filter(isB2b)
  .filter((m) => ["Member", "Team Leader", "Coordinator"].includes(m.role))
  .sort((a, b) => a.name.localeCompare(b.name));
if (takers.length === 0) throw new Error("no B2B/BD members or MMs to hand accounts to");

const admin = (crew ?? []).find(
  (m) => (m.email ?? "").toLowerCase() === (env.adminEmails[0] ?? "").toLowerCase()
);

// ---- what they are getting ----------------------------------------------
const { data: pool, error } = await db()
  .from("accounts")
  .select("id, name, function, phone")
  .is("responsible_id", null)
  .eq("out_of_process", false)
  .eq("is_test", false)
  .not("phone", "is", null)
  .neq("phone", "")
  .limit(2000);
if (error) throw new Error(error.message);
const usable = (pool ?? []).filter((a) => /\d/.test(a.phone ?? ""));
console.log(`pool: ${usable.length} unassigned names with a real phone`);
if (usable.length < TOTAL) throw new Error(`only ${usable.length} available`);

// Fisher–Yates, so "shuffled" means shuffled and not "the first 50 by id"
for (let i = usable.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [usable[i], usable[j]] = [usable[j], usable[i]];
}
const picked = usable.slice(0, TOTAL);

// deal them round-robin: everybody gets within one of everybody else
const deal = new Map(takers.map((m) => [m.id, []]));
picked.forEach((a, i) => deal.get(takers[i % takers.length].id).push(a));

for (const m of takers) {
  const got = deal.get(m.id);
  console.log(` ${m.name} (${m.role}) → ${got.length}${m.email ? "" : "  [no email — bell only]"}`);
}
if (DRY) {
  console.log("\nDRY RUN — nothing written. Re-run with --go to hand them out.");
  process.exit(0);
}

// ---- hand them over ------------------------------------------------------
let moved = 0;
for (const m of takers) {
  const got = deal.get(m.id);
  if (got.length === 0) continue;
  const ids = got.map((a) => a.id);
  const { error: upErr } = await db()
    .from("accounts")
    .update({ responsible_id: m.id, function: "B2B" })
    .in("id", ids);
  if (upErr) {
    console.error(` ! ${m.name}: ${upErr.message}`);
    continue;
  }
  moved += ids.length;
  // audit, one row per account, exactly like reassignAccount writes
  await db().from("audit_log").insert(
    got.map((a) => ({
      actor_id: admin?.id ?? null,
      action: "account_reassigned",
      entity: "account",
      entity_id: a.id,
      details: {
        to: m.name,
        function_from: a.function,
        function_to: "B2B",
        via: "B2B market-research hand-out",
      },
    }))
  );
  const names = got.map((a) => a.name);
  const { notifyMembers } = await import("../src/server/notify.ts");
  await notifyMembers(
    [m.id],
    "broadcast",
    `📋 ${names.length} new accounts are yours`,
    `${names.slice(0, 5).join(" · ")}${names.length > 5 ? ` · +${names.length - 5} more` : ""} — market research with phone numbers, filed under B2B. Start calling! 📞`,
    admin?.id ?? null,
    "/accounts"
  );
  if (m.email) {
    const { accountsAssignedEmail } = await import("../src/lib/email/templates.ts");
    const { sendEmail } = await import("../src/lib/google/gmail.ts");
    const mail = accountsAssignedEmail({
      memberName: m.name,
      managerName: admin?.name ?? "The EB",
      accountNames: names,
      accountsUrl: `${env.appUrl}/accounts`,
    });
    await sendEmail({ to: [m.email], ...mail }).catch((e) =>
      console.error(` ! email to ${m.name} failed:`, e.message)
    );
    console.log(` ✔ ${m.name}: ${ids.length} accounts, bell + email`);
  } else {
    console.log(` ✔ ${m.name}: ${ids.length} accounts, bell only (no email on file)`);
  }
}
console.log(`\ndone — ${moved} accounts handed out to ${takers.length} people`);
process.exit(0);
