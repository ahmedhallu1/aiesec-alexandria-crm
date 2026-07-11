import "server-only";
import { db } from "@/lib/supabase";

export type NotificationKind =
  | "welcome"
  | "reset"
  | "visit"
  | "followup"
  | "thanks"
  | "broadcast"
  | "info";

/** Writes in-app notifications. Best-effort: failures are logged, never thrown
 *  (the triggering action must not break if the table is missing pre-0008). */
export async function notifyMembers(
  memberIds: string[],
  kind: NotificationKind,
  title: string,
  body?: string | null,
  createdBy?: string | null
): Promise<void> {
  const ids = [...new Set(memberIds)].filter(Boolean);
  if (ids.length === 0) return;
  try {
    const { error } = await db()
      .from("notifications")
      .insert(
        ids.map((member_id) => ({
          member_id,
          kind,
          title,
          body: body ?? null,
          created_by: createdBy ?? null,
        }))
      );
    if (error) console.error("[notify] insert failed:", error.message);
  } catch (e) {
    console.error("[notify] failed:", e);
  }
}
