import "server-only";
import { db } from "@/lib/supabase";
import { sandboxSuppressed } from "@/server/sandbox";
import type { NotifyTopic } from "@/lib/member-settings";

export type NotificationKind =
  | "welcome"
  | "reset"
  | "visit"
  | "visit_announcement"
  | "followup"
  | "thanks"
  | "broadcast"
  | "lc_feedback"
  | "podio_update"
  | "report"
  /** v36 — a PDP filed for you, or the deadline chasing you */
  | "pdp"
  | "info";

/** Writes in-app notifications. Best-effort: failures are logged, never thrown
 *  (the triggering action must not break if the table is missing pre-0008).
 *  `link` is an optional in-app path (e.g. /accounts/<slug>) the bell opens on
 *  click; it degrades to a plain notification if column 0010 isn't applied. */
export async function notifyMembers(
  memberIds: string[],
  kind: NotificationKind,
  title: string,
  body?: string | null,
  createdBy?: string | null,
  link?: string | null,
  /** what this is about (v36.2). Members who switched the topic's App
   *  notifications off are skipped — the bell and the phone push alike, since
   *  the push is this same notification. Omit only for the few that are not
   *  preferences (a password reset, the welcome). */
  topic?: NotifyTopic | null
): Promise<void> {
  // NOBODY IS TOLD ABOUT THEIR OWN CLICK (v33.43). 24 of the last 34
  // "Visit booked" bells went to the person who had just booked it, and the
  // bookers of touch points were belling themselves too. A notification is
  // for news you don't already have; the actor watched it happen and got a
  // toast for it. One guard, so no future caller has to remember.
  let ids = [...new Set(memberIds)].filter(
    (id) => Boolean(id) && (!createdBy || id !== createdBy)
  );
  if (ids.length === 0) return;
  if (topic) {
    const { membersWanting } = await import("./member-settings");
    ids = await membersWanting(ids, topic, "bell");
    if (ids.length === 0) return;
  }
  if (await sandboxSuppressed(`notification "${title}" → ${ids.length} member(s)`)) return;
  const rows = ids.map((member_id) => ({
    member_id,
    kind,
    title,
    body: body ?? null,
    created_by: createdBy ?? null,
    ...(link ? { link } : {}),
  }));
  try {
    const { error } = await db().from("notifications").insert(rows);
    // pre-0010 the `link` column doesn't exist — retry without it
    if (error && link && error.message.includes("link")) {
      const bare = rows.map((r) => {
        const { link: _link, ...rest } = r as typeof r & { link?: string };
        void _link;
        return rest;
      });
      const { error: e2 } = await db().from("notifications").insert(bare);
      if (e2) console.error("[notify] insert failed:", e2.message);
    } else if (error) {
      console.error("[notify] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[notify] failed:", e);
  }

  // AND ON THE PHONE (v35). Every notification Sodio already files now also
  // goes out as a web push — which is the SAME channel the Android app uses,
  // because the Play build is a TWA and its notifications are these ones
  // delegated to its tray. Hooked HERE and nowhere else, so a new caller gets
  // phone delivery by writing a bell notification, exactly as before: there is
  // no second list of "things that also push" to keep in step.
  //
  // Best-effort, and deliberately after the insert: the bell is the record,
  // the push is a courtesy. `sendPushToMembers` re-checks the sandbox and
  // returns quietly when no VAPID keys are configured.
  try {
    const { sendPushToMembers } = await import("./push");
    const deliver = () =>
      sendPushToMembers(ids, { title, body, url: link ?? "/" }).catch((e) =>
        console.error("[notify] push failed:", e)
      );
    // Next's `after()` keeps the response fast — but it only exists inside a
    // request, and this module is also reached from the import scripts, so a
    // failure to schedule falls back to just awaiting it.
    try {
      const { after } = await import("next/server");
      after(deliver);
    } catch {
      await deliver();
    }
  } catch (e) {
    console.error("[notify] push unavailable:", e);
  }
}
