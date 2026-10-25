import type { Metadata } from "next";
import { getViewer } from "@/server/data";
import { canSeeWarRoom } from "@/lib/rbac";
import { gateTab } from "@/server/tabs";
import { loadWarEntries, loadWarPeople, loadWarSettings } from "@/server/war";
import { WAR_PUBLIC_PATH, WAR_ROOM_PATH } from "@/lib/war/model";
import { WarRoomView } from "@/components/war/war-room-view";

export const metadata: Metadata = { title: "War Room" };

/** THE WAR ROOM (v38) — where the F&L VP logs No Peace war points. Who gets
 *  in: `canSeeWarRoom` by code, widened or narrowed from Settings → Tabs —
 *  and the actions (server/war-actions.ts) ask the very same question. Every
 *  save is pushed live to the public board at /no-peace. */
export default async function WarRoomPage() {
  const viewer = await getViewer();
  await gateTab(viewer, WAR_ROOM_PATH, canSeeWarRoom(viewer));
  const [{ settings, updatedAt, updatedBy }, people, entries] = await Promise.all([
    loadWarSettings(),
    loadWarPeople(),
    loadWarEntries({ withDeleted: true }),
  ]);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://sodio.vercel.app";
  return (
    <WarRoomView
      settings={settings}
      settingsMeta={{ updatedAt, updatedBy }}
      people={people}
      entries={entries}
      publicUrl={`${base}${WAR_PUBLIC_PATH}`}
      readOnly={!!viewer.impersonated}
    />
  );
}
