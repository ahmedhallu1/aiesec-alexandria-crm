"use server";

import { getViewer } from "@/server/data";
import { db } from "@/lib/supabase";

/** The walkthrough has been shown to this member (v36.6) — see
 *  src/lib/tour-state.ts. Never written from an admin's test view: the tour is
 *  the real person's to see. Deliberately no revalidation: nothing on screen
 *  depends on it, and a re-render would cost a server render per member. */
export async function markTourSeen(): Promise<{ ok: boolean }> {
  const viewer = await getViewer();
  if (viewer.impersonated) return { ok: false };
  const { error } = await db()
    .from("members")
    .update({ tour_seen_at: new Date().toISOString() })
    .eq("id", viewer.id)
    .is("tour_seen_at", null);
  if (error) console.error("[tour] mark seen failed:", error.message);
  return { ok: !error };
}
