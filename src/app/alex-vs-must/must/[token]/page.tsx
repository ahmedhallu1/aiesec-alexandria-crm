import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { publicPageLive } from "@/server/tabs";
import { loadRaceEntries, raceSnapshot, rivalTokenOk } from "@/server/race";
import { RACE_EDITOR_PATH, isRaceToken, rivalDeskOpen } from "@/lib/race/model";
import { cairoToday } from "@/lib/types";
import { RivalDesk } from "@/components/race/desk";

/** MUST'S SLOTS DESK (v38.5) — no login: the secret in the link IS the key
 *  (checked in constant time; remade from Sodio to shut an old link out).
 *  MUST adds the slots it raised and can take back what it added; nothing
 *  else. Off with the public board (Settings → Tabs), never indexed. */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "MUST · Slots desk" },
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#050716" };

export default async function RivalDeskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isRaceToken(token)) notFound();
  if (!(await publicPageLive(RACE_EDITOR_PATH))) notFound();
  const { ok, settings } = await rivalTokenOk(token);
  if (!ok) notFound();
  const [snapshot, entries] = await Promise.all([raceSnapshot(), loadRaceEntries({ side: "rival" })]);
  const open = rivalDeskOpen(settings);
  return (
    <RivalDesk
      token={token}
      snapshot={snapshot}
      entries={entries.map((e) => ({ id: e.id, qty: e.qty, note: e.note, occurred_on: e.occurred_on, created_at: e.created_at, mine: e.source === "link" }))}
      open={open}
      today={cairoToday()}
    />
  );
}
