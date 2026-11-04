import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { publicPageLive } from "@/server/tabs";
import { raceSnapshot } from "@/server/race";
import { realtimeClientConfig } from "@/server/realtime";
import { RACE_EDITOR_PATH } from "@/lib/race/model";
import { RaceBoard } from "@/components/race/board";

/** PUBLIC (v38.5, no session — exempted in src/proxy.ts): Alex vs MUST, the
 *  race to 150 approvals between AIESEC in Alexandria and AIESEC in MUST.
 *  Edited in Sodio's "Alex vs MUST" tab (/lc-race); every change is pushed
 *  here over Supabase Realtime. The LCP and the admins can take it down from
 *  Settings → Tabs (that tab's public page switch). Counts and times only —
 *  never a note, an account or a person (lib/race/model.ts). */

export const dynamic = "force-dynamic";

const title = "Alex vs MUST · Race to 150";
const description =
  "AIESEC in Alexandria vs AIESEC in MUST — two LCs racing to 150 approvals before Activate. Live from CORE.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  openGraph: { type: "website", title, description, siteName: "AIESEC in Alexandria" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = { themeColor: "#050716" };

export default async function AlexVsMustPage() {
  if (!(await publicPageLive(RACE_EDITOR_PATH))) notFound();
  // asks CORE first (cached 15 min) and stores a reading if a number moved
  const snapshot = await raceSnapshot({ observe: true });
  return <RaceBoard initial={snapshot} realtime={realtimeClientConfig()} />;
}
