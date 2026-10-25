import { gateTab, publicPageLive } from "@/server/tabs";
import { ACTIVATION_TAB } from "@/lib/tabs";
import type { Metadata } from "next";
import { getViewer } from "@/server/data";
import { canSeeActivationBid } from "@/lib/rbac";
import { loadActivationPlan } from "@/server/activation";
import { ActivationBoard } from "@/components/activation/board";
import { ACTIVATION_PUBLIC_PATH } from "@/lib/activation/model";

export const metadata: Metadata = { title: "Activate 26' Bid" };

/** The bid plan inside Sodio: MMs and above (v36.8) read it and flip it to
 *  Edit — and, since v38, whoever Settings → Tabs opens it to (the actions ask
 *  the same rule). The same board is served read-only, without a session, at
 *  /activate26 — where a person it is closed to is sent, rather than to a
 *  dead end; unless the LC took that page down too, then home (v38.3 — it
 *  used to send them to the 404). */
export default async function ActivationPage() {
  const viewer = await getViewer();
  await gateTab(
    viewer,
    ACTIVATION_TAB,
    canSeeActivationBid(viewer),
    (await publicPageLive(ACTIVATION_TAB)) ? ACTIVATION_PUBLIC_PATH : "/"
  );
  const plan = await loadActivationPlan({ publicView: false });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://sodio.vercel.app";
  return (
    <ActivationBoard
      initial={plan}
      // an admin's test view reads it but never edits as someone else
      editable={!viewer.impersonated}
      publicUrl={`${base}${ACTIVATION_PUBLIC_PATH}`}
      embedded
    />
  );
}
