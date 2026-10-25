import { gateTab } from "@/server/tabs";
import { getViewer } from "@/server/data";
import { getPdpPage } from "@/server/pdp";
import { PdpView } from "@/components/crm/pdp-view";

export const metadata = { title: "PDP & O2O — Sodio" };

/** ONE-ON-ONES AND DEVELOPMENT PLANS (v36 — ask #3).
 *
 *  ⚠️ GATED SERVER-SIDE, not just hidden in the nav. `getPdpPage` decides
 *  everything — who this viewer owes a conversation to, which plans they may
 *  read, whether they run the process at all — so this component is a gate and
 *  a hand-off and nothing else. A PDP names what somebody is bad at; the read
 *  rule is deliberately narrower than `hasTmAccess`.
 *
 *  Nobody is turned away: a Member with nobody under them still has their OWN
 *  plan to read and their own weekly steps to tick, which is the half of this
 *  process the sheets never gave them. */
export default async function PdpPage() {
  const viewer = await getViewer();
  const data = await getPdpPage(viewer);

  // Only somebody the process does not touch AT ALL — no plan of their own, no
  // one to file for, no oversight — is sent away. That is a rare row (an
  // inactive-ish member with no manager), and showing them an empty page with
  // three headings would be worse than the dashboard.
  const touched =
    !!data.mine ||
    data.myHistory.length > 0 ||
    data.targets.mms.length > 0 ||
    data.targets.others.length > 0 ||
    data.runsProcess;
  await gateTab(viewer, "/pdp", touched);

  return <PdpView data={data} viewerId={viewer.id} viewerName={viewer.name} />;
}
