import type { Metadata } from "next";
import { getViewer } from "@/server/data";
import { loadActivationPlan } from "@/server/activation";
import { ActivationBoard } from "@/components/activation/board";
import { ACTIVATION_PUBLIC_PATH } from "@/lib/activation/model";

export const metadata: Metadata = { title: "Activate 26' Bid" };

/** The bid plan inside Sodio (v36.7): every member can flip it to Edit.
 *  The same board is served read-only, without a session, at /activate26. */
export default async function ActivationPage() {
  const viewer = await getViewer();
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
