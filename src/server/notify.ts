import "server-only";
import { db } from "@/lib/supabase";
import { sandboxSuppressed } from "@/server/sandbox";

export type NotificationKind =
  | "welcome"
  | "reset"
  | "visit"
  | "visit_announcement"
  | "followup"
  | "thanks"
  | "broadcast"
  | "lc_feedback"
  | "report"
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
  link?: string | null
): Promise<void> {
  const ids = [...new Set(memberIds)].filter(Boolean);
  if (ids.length === 0) return;
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
}
