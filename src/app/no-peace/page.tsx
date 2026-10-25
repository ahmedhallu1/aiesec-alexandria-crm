import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { publicPageLive } from "@/server/tabs";
import { warSnapshot } from "@/server/war";
import { realtimeClientConfig } from "@/server/realtime";
import { coreNationalStanding } from "@/lib/core-analytics";
import { WAR_ROOM_PATH } from "@/lib/war/model";
import { NoPeaceBoard } from "@/components/no-peace/board";

/** PUBLIC (v38, no session — exempted in src/proxy.ts): AIESEC in
 *  Alexandria's "No Peace" war board, live. Edited in Sodio's War Room
 *  (/war-room); every save is pushed here over Supabase Realtime. The LCP and
 *  the admins can take it down from Settings → Tabs (the War Room tab's
 *  public page switch). Shows names and points only — never a contact, a
 *  comment or who logged what (lib/war/model.ts `buildSnapshot`). */

export const dynamic = "force-dynamic";

const title = "No Peace · AIESEC in Alexandria";
const description =
  "We're declaring war. The live points board of AIESEC in Alexandria's No Peace campaign — standings, dispatches, rewards and where Alexandria stands nationally.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  openGraph: { type: "website", title, description, siteName: "AIESEC in Alexandria" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = { themeColor: "#091417" };

export default async function NoPeacePage() {
  if (!(await publicPageLive(WAR_ROOM_PATH))) notFound();
  const snapshot = await warSnapshot();
  const national = snapshot.settings.show.national ? await coreNationalStanding().catch(() => null) : null;
  return <NoPeaceBoard initial={snapshot} national={national} realtime={realtimeClientConfig()} />;
}
