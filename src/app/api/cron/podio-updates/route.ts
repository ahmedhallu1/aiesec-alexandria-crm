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

/** Continuous Podio updates (v23 B2C → v24 every function that opts in).
 *  Daily: for every ACTIVE account with the feature ON whose refresh date has
 *  arrived, ping the RESPONSIBLE **and their Team Leader** (v36 — never a VP
 *  or Director; an unowned account raises nothing at all), everything batched
 *  into ONE email per audience — bell + email,
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
  // ⚠️ v36 — THE REMINDER GOES UP TO THE TEAM LEADER, NEVER TO A VP.
  //
  // The rule from the floor: an account belonging to a MEMBER is chased with
  // their Team Leader; an account belonging to a TEAM LEADER is chased with
  // that Team Leader alone. No VP or Director on any of it.
  //
  // The reason is volume and usefulness in the same breath. A VP holds a whole
  // function, so "everyone's overdue Podio accounts" is a daily digest they
  // cannot act on personally and will filter within a week — while the Team
  // Leader is the one person who can actually turn to the member and ask. This
  // is the same lesson v34.1 learnt when it stopped sending one email PER
  // ACCOUNT; the audience was still one level too high.
  //
  // So the whole membership is read for the manager chain instead of the
  // VP/Director list. It is ~80 rows once per day.
  const membersRes = await db()
    .from("members")
    .select("id, name, email, role, stakeholder_id, is_active")
    .eq("is_active", true);
  if (membersRes.error) {
    console.error("[podio-updates] members query failed:", membersRes.error.message);
    return NextResponse.json({ ok: false, error: membersRes.error.message }, { status: 500 });
  }
  interface MemberLite {
    id: string; name: string; email: string | null;
    role: string; stakeholder_id: string | null; is_active: boolean;
  }
  const byId = new Map<string, MemberLite>();
  for (const m of (membersRes.data ?? []) as MemberLite[]) byId.set(m.id, m);

  /** The Team Leader this account should be chased WITH, or null.
   *
   *  ⚠️ A MEMBER'S MANAGER IS NOT ALWAYS A TEAM LEADER, and that is not an
   *  edge case here: `defaultManagerId` attaches anyone with a blank Manager
   *  cell straight to their function's VP, and production also carries four
   *  Coordinators and two Team Leaders with no reports at all. So the chain is
   *  walked and anything that is not a Team Leader is DROPPED rather than
   *  quietly promoted back into the VP inbox this change exists to empty.
   *
   *  A COORDINATOR IS THEIR OWN MM (v36): they hold no team and answer for
   *  their own numbers, so there is nobody above them to chase them with, and
   *  they get the reminder alone. Same for a Team Leader — "the TL himself
   *  only" is the rule as it was given. */
  const teamLeaderFor = (memberId: string): MemberLite | null => {
    const me = byId.get(memberId);
    if (!me) return null;
    if (me.role === "Team Leader") return me; // a TL is chased as themselves
    if (me.role === "Coordinator") return null; // an MM with no team above them
    const mgr = me.stakeholder_id ? byId.get(me.stakeholder_id) : undefined;
    return mgr && mgr.is_active && mgr.role === "Team Leader" ? mgr : null;
  };

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
    // ⚠️ AN ACCOUNT NOBODY OWNS RAISES NO REMINDER AT ALL (v36).
    //
    // It used to fall back to the function's VPs/Directors, which is precisely
    // the audience this release is removing — and the fallback was answering
    // the wrong question anyway. A Podio "continuous update" asks a person to
    // go and refresh a partner they are working; an unassigned name is not
    // being worked by anyone, so there is no update to make and nobody to ask.
    // v36 also makes the unclaimed pool function-less (0073), so "the IGV
    // leaders" would not even be a resolvable audience for one.
    //
    // The account is NOT stamped in this case, so it re-enters the cycle the
    // moment somebody claims it — silence here is a pause, not a drop.
    if (!responsible) continue;

    const tl = teamLeaderFor(responsible.id);
    // Everyone who should hear about it: the person who must do the work, and
    // their Team Leader when they have one. `tl` IS the responsible when the
    // responsible is themselves a Team Leader, so the Set collapses to one.
    const people = new Map<string, { id: string; name: string; email: string | null }>();
    people.set(responsible.id, responsible);
    if (tl) people.set(tl.id, tl);

    // One digest per AUDIENCE, so a Team Leader carrying three members' overdue
    // accounts gets one email listing all of them rather than three.
    const key = [...people.keys()].sort().join("+");
    let bucket = buckets.get(key);
    if (!bucket) {
      const all = [...people.values()];
      bucket = {
        memberId: responsible.id,
        name: all.map((p) => p.name).join(" & "),
        emails: all.map((p) => p.email).filter((e): e is string => !!e),
        due: [],
      };
      bucket.leaderIds = all.map((p) => p.id); // everyone gets the bell too
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
      // v36: the bell reaches the same people as the email — the responsible
      // and their Team Leader — so the two channels cannot say different
      // things about who is accountable for this account.
      const bellIds = bucket.leaderIds ?? (bucket.memberId ? [bucket.memberId] : []);
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
          total === 1 ? `/accounts/${accountSlug(bucket.due[0].name)}` : `/accounts`,
          "podio"
        );
      }

      if (bucket.emails.length > 0) {
        const mail = podioUpdateDigestEmail({
          firstName: bucket.name.split(" ")[0],
          due: first,
          stillPending: second,
          accountsUrl: `${env.appUrl}/accounts`,
        });
        await sendEmail({ topic: "podio", to: [...new Set(bucket.emails)], ...mail });
      }

      // stamp only AFTER the digest went out — a failed send must retry.
      // One write per PASS, not per account (v37.14): a digest of twenty
      // accounts was twenty sequential round trips.
      for (const [list, patch] of [
        [first, { podio_update_notified_at: now.toISOString() }],
        [second, { podio_update_second_notified_at: now.toISOString() }],
      ] as const) {
        if (list.length === 0) continue;
        const { error: stampError } = await db()
          .from("accounts")
          .update(patch)
          .in("id", list.map((d) => d.id));
        if (stampError)
          throw new Error(
            `stamp failed for ${list.map((d) => d.name).join(", ")}: ${stampError.message}`
          );
      }
      sent.push(`${bucket.name}: ${bucket.due.length} account(s)`);
    } catch (e) {
      errors.push(`${bucket.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  await markCronRun("podio-updates");
  return NextResponse.json({ ok: true, sent, errors });
}
