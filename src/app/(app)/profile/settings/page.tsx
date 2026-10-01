import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getViewer, profilePeople, signupViewsFor, b2cCicAccess, mmAccessBlocks } from "@/server/data";
import {
  canRunLcTools, hasConsiderationAccess, hasOgxAccess, hasRaisingAccess, isB2C, ogxFunctions,
} from "@/lib/rbac";
import { hasCxpAccess } from "@/lib/cxp/rbac";
import { memberSettings } from "@/server/member-settings";
import { homeOptionsFor } from "@/lib/home-options";
import { dashboardLaneViews } from "@/lib/dashboard-lanes";
import { PAGE_SIZES } from "@/lib/page-size";
import { exportsFor } from "@/server/exports";
import { handoverFor, lcOverview } from "@/server/lc-term";
import { SettingsHub, type HubTab } from "@/components/crm/settings-hub";

export const metadata = { title: "Settings" };

/** SETTINGS (v37.2) — one page in sections, and the sections follow the
 *  person: everyone manages their notifications, their defaults and their
 *  data; a Team Leader their team; a VP/Director their function (and reads
 *  the handover); the LCP and admins the LC tools for a new peak or term. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  const sp = await searchParams;
  const { manageableFunctions, allFunctionSettings } = await import("@/server/function-settings");
  const ogx = ogxFunctions(viewer).length > 0;
  const myFns = manageableFunctions(viewer);
  const isTl = viewer.role === "Team Leader";

  const [settings, fnSettings, people, handover, lc, mmAccess] = await Promise.all([
    memberSettings(viewer.id),
    myFns.length > 0
      ? allFunctionSettings().then((all) => myFns.map((fn) => ({ fn, ...all[fn] })))
      : Promise.resolve([]),
    isTl ? profilePeople(viewer).catch(() => null) : Promise.resolve(null),
    handoverFor(viewer).catch(() => null),
    lcOverview(viewer).catch(() => null),
    // a test view shows the card, but setMmAccess refuses to save from one
    myFns.length > 0 ? mmAccessBlocks(viewer).catch(() => []) : Promise.resolve([]),
  ]);

  const tabs: HubTab[] = [
    "notifications",
    "defaults",
    ...(isTl ? (["team"] as HubTab[]) : []),
    ...(fnSettings.length > 0 ? (["function"] as HubTab[]) : []),
    "data",
    ...(handover ? (["handover"] as HubTab[]) : []),
    ...(lc && canRunLcTools(viewer) ? (["lc"] as HubTab[]) : []),
  ];
  const tab = tabs.includes(sp.tab as HubTab) ? (sp.tab as HubTab) : "notifications";

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        href="/profile"
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> My profile
      </Link>
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsHub
        tab={tab}
        tabs={tabs}
        notifications={{
          settings,
          context: {
            ogx,
            leadsFunction: myFns.length > 0,
            hasPassword: !!viewer.password_hash,
            raising: hasRaisingAccess(viewer),
            consideration: hasConsiderationAccess(viewer),
            signups: ogx || isB2C(viewer),
            cxp: hasCxpAccess(viewer),
          },
        }}
        defaults={{
          values: settings.defaults,
          homeOptions: homeOptionsFor(viewer),
          laneOptions: dashboardLaneViews(viewer).map((v) => ({ value: v.key, label: v.label })),
          pageSizes: PAGE_SIZES,
          signupViews: hasOgxAccess(viewer) || b2cCicAccess(viewer) ? signupViewsFor(viewer) : [],
        }}
        team={people ? people.people : isTl ? [] : null}
        fnSettings={fnSettings}
        mmAccess={mmAccess}
        exports={exportsFor(viewer).map((e) => ({ id: e.id, label: e.label, description: e.description }))}
        handover={handover}
        lc={lc}
      />
    </div>
  );
}
