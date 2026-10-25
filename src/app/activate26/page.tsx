import type { Metadata } from "next";
import { loadActivationPlan } from "@/server/activation";
import { ActivationBoard } from "@/components/activation/board";
import { notFound } from "next/navigation";
import { publicPageLive } from "@/server/tabs";
import { ACTIVATION_TAB } from "@/lib/tabs";

/** PUBLIC (v36.7, no session — exempted in src/proxy.ts): AIESEC in
 *  Alexandria's bid to host Activate 26', read-only. The plan is edited inside
 *  Sodio at /activation; this page shows the same board with editing off, the
 *  sections the LC hid removed, and no individual names unless the LC chose to
 *  show them (lib/activation/model.ts `publicPlan`). */

// live data — edits inside Sodio must show here on the next visit
export const dynamic = "force-dynamic";

const title = "Activate 26' · AIESEC in Alexandria's bid";
const description =
  "The whole show, act by act: the road from the bid result to curtain up, nine checkpoints, the organizing committee and the run of show.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  openGraph: { type: "website", title, description, siteName: "AIESEC in Alexandria" },
  twitter: { card: "summary_large_image", title, description },
};

export default async function ActivatePublicPage() {
  // v38 — the LCP/admins can take the public copy down (Settings → Tabs)
  if (!(await publicPageLive(ACTIVATION_TAB))) notFound();
  const plan = await loadActivationPlan({ publicView: true });
  return <ActivationBoard initial={plan} editable={false} publicUrl="" embedded={false} />;
}
