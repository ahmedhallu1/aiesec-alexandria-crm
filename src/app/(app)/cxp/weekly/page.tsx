import { getViewer } from "@/server/data";
import { gateTab } from "@/server/tabs";
import { redirect } from "next/navigation";
import { cxpAccess, weeklyBoard } from "@/server/cxp";
import { CxpWeeklyView } from "@/components/crm/cxp-weekly-view";
import type { CxpSide } from "@/lib/cxp/types";

export const metadata = { title: "CXP — Weekly" };

/** THE WEEKLY BOARD.
 *
 *  THIS SIGNATURE IS THE FIX. The old app's weekly page was
 *  `export default async function WeeklyPage()` — no `searchParams`, so a
 *  Next.js App Router page was structurally incapable of receiving the selected
 *  week, which is why clicking a chip changed nothing. `deadline` now arrives
 *  here and is threaded into the selector. */
export default async function CxpWeeklyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await cxpAccess();
  // v38 — the tab rule (Settings → Tabs) can open or close it on top
  await gateTab(await getViewer(), "/cxp", access.allowed);
  const sp = await searchParams;

  const requested = sp.side as CxpSide | undefined;
  const side =
    requested && access.sides.includes(requested) ? requested : access.defaultSide;

  // `weeklyBoard` validates the deadline against the six it offers, so a
  // hand-edited URL cannot select a week the board does not have
  const board = await weeklyBoard({ side, selected: sp.deadline ?? null });
  // null = no CXP function to read (a person a tab rule opened CXP to): back
  // to the module's own page, never "/" after the gate passed (v38.3)
  if (!board) redirect("/cxp");

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-bold">Weekly submission</h1>
        <p className="text-sm text-muted-foreground">
          What each function owes the ECB at the 6th, 13th, 20th and 27th.
        </p>
      </div>
      <CxpWeeklyView
        deadlines={board.deadlines}
        selected={board.selected}
        isPast={board.isPast}
        summaries={board.summaries}
        eps={board.eps}
        side={side}
        sides={access.sides}
        canOps={access.canOps}
        zipFiles={board.zipFiles}
      />
    </div>
  );
}
