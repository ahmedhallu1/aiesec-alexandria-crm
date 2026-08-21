import { NextRequest, NextResponse } from "next/server";
import { notifyMembers } from "@/server/notify";
import { markCronRun } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { podioUpdateDigestEmail, type PodioDueAccount } from "@/lib/email/templates";
import { accountSlug, podioDefaultDays, type AccountFunction } from "@/lib/types";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface PodioRow {
  id: string;
  name: string;
  function: AccountFunction;
  created_at: string;
  podio_update_every_days: number | null;
  podio_updated_at: string | null;
  podio_update_notified_at: string | null;
  podio_update_second_notified_at: string | null;
  responsible: {
    id: string;
    name: string;
    email: string;
    is_active: boolean;
  } | null;
}

/** Which VP/Director "owns" reminders for an account of this function.
 *  BD accounts belong to the B2B&BD crew (either label counts). */
function leaderMatches(
  m: { functions?: string[] | null; sub_functions?: string[] | null },
  fn: AccountFunction
): boolean {
  const all = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
  if (fn === "BD" || fn === "B2B") return all.includes("B2B") || all.includes("BD");
  return all.includes(fn);
}

/** Continuous Podio updates (v23 B2C → v24 every function that opts in).
 *  Daily: for every ACTIVE account with the feature ON whose refresh date has
 *  arrived, ping the RESPONSIBLE (v34.1 — leaders only for unowned accounts,
 *  and everything batched into ONE email per person) — bell + email,
 *  ONCE per cycle (podio_update_notified_at). A week after that first nag with
 *  still no update, a SECOND, firmer reminder goes out — also once per cycle
 *  (podio_update_second_notified_at; "Updated on Podio" clears both). */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // every enabled account — paged past Supabase's 1000-row response cap
  // (new IGV/B2C/BD accounts default ON, so this set will keep growing)
  const accountsData: unknown[] = [];
  {
    const PAGE = 1000;
    for (let off = 0; off < 30000; off += PAGE) {
      const { data, error } = await db()
        .from("accounts")
        .select(
          "id, name, function, created_at, podio_update_every_days, podio_updated_at, " +
            "podio_update_notified_at, podio_update_second_notified_at, " +
            "responsible:members!accounts_responsible_id_fkey(id, name, email, is_active)"
        )
        .eq("podio_update_enabled", true)
        .eq("out_of_process", false)
        .eq("is_test", false)
        .order("created_at")
        .order("id")
        .range(off, off + PAGE - 1);
      if (error) {
        console.error("[podio-updates] accounts query failed:", error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      accountsData.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
  }
  // VPs/Directors — the function label may live in sub_functions only
  const leadersRes = await db()
    .from("members")
    .select("id, name, email, role, functions, sub_functions")
    .eq("is_active", true)
    .in("role", ["LCVP", "Director"]);
  if (leadersRes.error) {
    console.error("[podio-updates] leaders query failed:", leadersRes.error.message);
    return NextResponse.json({ ok: false, error: leadersRes.error.message }, { status: 500 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allLeaders = (leadersRes.data ?? []) as any[];

  const now = new Date();
  const sent: string[] = [];
  const errors: string[] = [];

  /** ONE EMAIL PER PERSON PER DAY, NOT ONE PER ACCOUNT (v34.1).
   *  A member holding twenty due accounts used to get twenty emails on the
   *  same morning, and every VP/Director of the function got everyone's — the
   *  fastest way to turn a reminder into a filter rule. The pass is worked out
   *  per account exactly as before; the SENDING is batched per recipient, and
   *  an account is only stamped once its digest actually went out, so a failed
   *  send retries tomorrow instead of going silent. */
  interface Bucket {
    memberId: string | null;
    name: string;
    emails: string[];
    /** set only on the unowned-account fallback bucket */
    leaderIds?: string[];
    due: (PodioDueAccount & { id: string; pass: 1 | 2 })[];
  }
  const buckets = new Map<string, Bucket>();

  for (const a of accountsData as PodioRow[]) {
    const every = a.podio_update_every_days ?? podioDefaultDays(a.function);
    const anchor = new Date(a.podio_updated_at ?? a.created_at);
    const due = new Date(anchor.getTime() + every * DAY_MS);
    if (now < due) continue; // countdown still running

    const firstAt =
      a.podio_update_notified_at && new Date(a.podio_update_notified_at) >= due
        ? new Date(a.podio_update_notified_at)
        : null;
    // pass 1: the cycle's first reminder. pass 2: a week after it, firmer.
    let pass: 1 | 2;
    if (!firstAt) pass = 1;
    else if (
      now.getTime() - firstAt.getTime() >= WEEK_MS &&
      !(a.podio_update_second_notified_at && new Date(a.podio_update_second_notified_at) >= due)
    )
      pass = 2;
    else continue; // already nagged this cycle

    const responsible = a.responsible && a.responsible.is_active ? a.responsible : null;
    // AN UNOWNED ACCOUNT STILL HAS TO REACH SOMEBODY. "Owner only" is the rule
    // for accounts that HAVE one; an unassigned or deactivated-owner account
    // would otherwise fall silently out of the cycle, so it goes to the
    // function's leaders as the fallback it always was.
    const leaders = responsible ? [] : allLeaders.filter((m) => leaderMatches(m, a.function));
    const key = responsible ? `m:${responsible.id}` : `fn:${a.function}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = responsible
        ? { memberId: responsible.id, name: responsible.name, emails: responsible.email ? [responsible.email] : [], due: [] }
        : {
            memberId: null,
            name: `${a.function} leaders`,
            emails: leaders.map((l) => l.email).filter(Boolean),
            due: [],
          };
      if (!responsible) bucket.leaderIds = leaders.map((l) => l.id);
      buckets.set(key, bucket);
    }
    bucket.due.push({
      id: a.id,
      pass,
      name: a.name,
      fn: a.function,
      url: `${env.appUrl}/accounts/${accountSlug(a.name)}`,
      daysOverdue: Math.floor((now.getTime() - due.getTime()) / DAY_MS),
      everyDays: every,
    });
  }

  for (const bucket of buckets.values()) {
    const first = bucket.due.filter((d) => d.pass === 1);
    const second = bucket.due.filter((d) => d.pass === 2);
    try {
      // one bell too — it names the count and opens the first account, rather
      // than twenty bells that each open one
      const bellIds = bucket.memberId ? [bucket.memberId] : (bucket.leaderIds ?? []);
      const total = bucket.due.length;
      if (bellIds.length > 0) {
        await notifyMembers(
          bellIds,
          "podio_update",
          total === 1
            ? `🔄 Update "${bucket.due[0].name}" on Podio`
            : `🔄 ${total} accounts need a Podio update`,
          second.length > 0
            ? `${second.length} of them were flagged a week ago and are still pending.`
            : `Refresh each on Podio, then mark it updated to reset the countdown.`,
          null,
          total === 1 ? `/accounts/${accountSlug(bucket.due[0].name)}` : `/accounts`
        );
      }

      if (bucket.emails.length > 0) {
        const mail = podioUpdateDigestEmail({
          firstName: bucket.name.split(" ")[0],
          due: first,
          stillPending: second,
          accountsUrl: `${env.appUrl}/accounts`,
        });
        await sendEmail({ to: [...new Set(bucket.emails)], ...mail });
      }

      // stamp only AFTER the digest went out — a failed send must retry
      for (const d of bucket.due) {
        const { error: stampError } = await db()
          .from("accounts")
          .update(
            d.pass === 2
              ? { podio_update_second_notified_at: now.toISOString() }
              : { podio_update_notified_at: now.toISOString() }
          )
          .eq("id", d.id);
        if (stampError) throw new Error(`stamp failed for ${d.name}: ${stampError.message}`);
      }
      sent.push(`${bucket.name}: ${bucket.due.length} account(s)`);
    } catch (e) {
      errors.push(`${bucket.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  await markCronRun("podio-updates");
  return NextResponse.json({ ok: true, sent, errors });
}
