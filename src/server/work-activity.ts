import "server-only";
import { after } from "next/server";
import { db } from "@/lib/supabase";
import { sandboxSuppressed } from "./sandbox";

// Lives OUTSIDE attendance.ts on purpose (v37.7): every export of a
// "use server" file is a public POST endpoint, and stampWork takes the member
// id from its caller — exported from there, anyone signed in could forge
// working-hours activity for anyone.

/** Every meaningful piece of work stamps one `work_activity` row — the raw
 *  material of AUTOMATIC working-hours attendance. Fire-and-forget: wrapped in
 *  `after()` so Vercel can't freeze the lambda over a floating promise, and
 *  never allowed to break the action that earned it.
 *
 *  Call it as the LAST line of an action's success path:
 *      await stampWork(viewer.id, "contact");
 *  (the await only covers the sandbox check — the insert runs after the
 *  response, so it costs the member nothing). */
export async function stampWork(viewerId: string, kind: string): Promise<void> {
  if (!viewerId) return;
  // a sandbox test view must never fabricate someone's working hours
  if (await sandboxSuppressed(`work stamp (${kind})`)) return;
  after(async () => {
    try {
      const { error } = await db()
        .from("work_activity")
        .insert({ member_id: viewerId, kind: String(kind).slice(0, 40) });
      if (error) console.error("[attendance] work stamp failed:", error.message);
    } catch (e) {
      console.error("[attendance] work stamp failed:", e);
    }
  });
}
