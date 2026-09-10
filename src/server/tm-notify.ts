import "server-only";
import { db } from "@/lib/supabase";
import { notifyMembers, type NotificationKind } from "./notify";
import { recordUndo, sandboxState } from "./sandbox";

/** TM notifications, SANDBOX-AWARE (v29.3).
 *
 *  The rule, in the admin's words: "on testing mode, everything happens but
 *  doesn't send or invite other people other than me — to not spam people."
 *  So a test view must LOOK like the real thing to the person testing it and
 *  be completely invisible to everybody else:
 *
 *    real session → the whole audience is notified, the normal way
 *    sandbox      → ONLY the acting viewer gets the bell, and no email is
 *                   sent at all (the callers keep gating every `sendEmail`
 *                   behind `sandboxSuppressed`)
 *
 *  Why not just call `notifyMembers`? It suppresses the insert entirely inside
 *  a sandbox, which is right for every other module but leaves the tester
 *  staring at nothing. Here the viewer's own copy is written directly and
 *  journaled to `test_undo`, so exiting the test view removes it again.
 *
 *  Every touch-point / attendance notification goes through this one helper —
 *  a new one can't forget the rule. */
export async function notifyTouchPointAudience(
  /** The member ACTING — inside a test view that is the IMPERSONATED member,
   *  i.e. the identity the tester is looking at, so the bell they are testing
   *  actually shows up for them. Nobody else is touched. */
  viewerId: string,
  /** everyone who would hear about it for real */
  memberIds: string[],
  kind: NotificationKind,
  title: string,
  body?: string | null,
  createdBy?: string | null,
  link?: string | null
): Promise<void> {
  const sandbox = await sandboxState();
  if (!sandbox.active) {
    await notifyMembers(memberIds, kind, title, body, createdBy, link, "touch_points");
    return;
  }

  console.log(
    `[sandbox] touch-point notification collapsed to the tester: "${title}" (${memberIds.length} real recipient(s) spared)`
  );
  if (!viewerId) return;
  try {
    const { data, error } = await db()
      .from("notifications")
      .insert({
        member_id: viewerId,
        kind,
        // marked as a test artefact: the rollback removes it on Exit, but a
        // session left open must never read as a real announcement
        title: `🧪 ${title}`,
        body: body ?? null,
        created_by: createdBy ?? null,
        ...(link ? { link } : {}),
      })
      .select("id")
      .single<{ id: string }>();
    if (error) {
      console.error("[sandbox] test notification failed:", error.message);
      return;
    }
    // journaled like every other sandbox write — Exit rolls it back
    if (data) await recordUndo("notifications", data.id, "insert");
  } catch (e) {
    console.error("[sandbox] test notification failed:", e);
  }
}
