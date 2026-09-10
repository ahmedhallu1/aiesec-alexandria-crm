import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getViewer } from "@/server/data";
import { hasConsiderationAccess, hasRaisingAccess, isB2C, ogxFunctions } from "@/lib/rbac";
import { hasCxpAccess } from "@/lib/cxp/rbac";
import { memberSettings } from "@/server/member-settings";
import { SettingsPanel } from "@/components/crm/settings-panel";

export const metadata = { title: "Settings" };

/** MY SETTINGS, ON A PAGE OF ITS OWN (v36.2) — entered from the profile.
 *
 *  It grew from five switches to one row per kind of message, which is too
 *  much to sit in the middle of the profile between the teams card and the
 *  function defaults. The profile keeps an entry card; this is where it goes. */
export default async function SettingsPage() {
  const viewer = await getViewer();
  const { manageableFunctions } = await import("@/server/function-settings");
  const settings = await memberSettings(viewer.id);
  const ogx = ogxFunctions(viewer).length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/profile"
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> My profile
      </Link>
      <SettingsPanel
        settings={settings}
        // which rows are worth showing: nobody should scroll past switches for
        // messages their role never receives
        context={{
          ogx,
          leadsFunction: manageableFunctions(viewer).length > 0,
          hasPassword: !!viewer.password_hash,
          raising: hasRaisingAccess(viewer),
          consideration: hasConsiderationAccess(viewer),
          signups: ogx || isB2C(viewer),
          cxp: hasCxpAccess(viewer),
        }}
      />
    </div>
  );
}
