import type { Metadata } from "next";
import { getViewer } from "@/server/data";
import { canSeeLcRace } from "@/lib/rbac";
import { gateTab } from "@/server/tabs";
import { loadRaceDeals, loadRaceEntries, loadRaceReadings, loadRaceSettings, observeCore } from "@/server/race";
import { RACE_EDITOR_PATH, RACE_PUBLIC_PATH, buildRaceSnapshot, rivalDeskPath } from "@/lib/race/model";
import { RaceEditor } from "@/components/race/race-editor";

export const metadata: Metadata = { title: "Alex vs MUST" };

/** ALEX vs MUST (v38.5) — where the EB runs the race with MUST: goals, dates,
 *  start counts, colours, MUST's private link, slots entries and readings.
 *  Who gets in: `canSeeLcRace` by code, widened or narrowed from Settings →
 *  Tabs — and the actions (server/race-actions.ts) ask the same question.
 *  Every save is pushed live to the public board at /alex-vs-must. */
export default async function LcRacePage() {
  const viewer = await getViewer();
  await gateTab(viewer, RACE_EDITOR_PATH, canSeeLcRace(viewer));
  const first = await loadRaceSettings();
  let readings = await loadRaceReadings();
  // a cheap look at CORE (15-minute cache) so the numbers here are current
  if ((await observeCore({ settings: first.settings, readings })).changed) readings = await loadRaceReadings();
  const [entries, deals] = await Promise.all([loadRaceEntries({ withDeleted: true }), loadRaceDeals(first.settings)]);
  const snapshot = buildRaceSnapshot({
    settings: first.settings,
    readings,
    entries: entries.filter((e) => !e.deleted_at),
    deals,
  });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://sodio.vercel.app";
  return (
    <RaceEditor
      settings={first.settings}
      meta={{ updatedAt: first.updatedAt, updatedBy: first.updatedBy }}
      snapshot={snapshot}
      readings={readings.slice(-80).reverse()}
      entries={entries}
      dealCount={deals.length}
      publicUrl={`${base}${RACE_PUBLIC_PATH}`}
      deskUrl={first.settings.rivalToken ? `${base}${rivalDeskPath(first.settings.rivalToken)}` : null}
      readOnly={!!viewer.impersonated}
    />
  );
}
