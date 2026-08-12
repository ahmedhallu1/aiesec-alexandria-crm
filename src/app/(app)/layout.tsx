import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getViewer, listViewAsTargets, needsMmPlan, needsTlPlan } from "@/server/data";
import { PLAN_SKIP_COOKIE } from "@/lib/plan-skip";
import {
  hasRaisingAccess, hasTmAccess, hasOgxAccess, hasConsiderationAccess,
  canManageMembership, canSeePlanning, canUseAdminTools, canUseMailboxTab,
  isB2C, isTmCore, seesEveryLane,
} from "@/lib/rbac";
import { signOut } from "@/lib/auth";
import { AppShell } from "@/components/crm/app-shell";
import { ComingSoon } from "@/components/crm/coming-soon";
import { GateClient } from "@/components/crm/gate-client";
import { Tour } from "@/components/crm/tour";
import { ViewAsBanner } from "@/components/crm/view-as-banner";
import { GoogleGrantBanner } from "@/components/crm/google-grant-banner";
import { db } from "@/lib/supabase";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();

  // first login: confirm info + set a password before anything else
  // (skipped in the admin's test view — never onboard on someone's behalf)
  if (!viewer.profile_completed_at && !viewer.impersonated) redirect("/welcome");

  // OGX & Consideration MMs must file their 6-month plan right after
  // onboarding — the numbers ARE their period goals
  // SKIPPABLE (v33.8). Filing a 6-month plan is the right thing to ask on day
  // one, but blocking the whole app until it's done meets a new member with a
  // wall — and someone who doesn't know their numbers yet will type anything
  // to get past it, which is worse than a blank. "Skip for now" sets a cookie
  // for the day; the profile's My-plan card is always there, and the reminder
  // comes back tomorrow.
  const skipped = (await cookies()).get(PLAN_SKIP_COOKIE)?.value === "1";
  if (
    !skipped &&
    viewer.profile_completed_at &&
    !viewer.impersonated &&
    (await needsMmPlan(viewer))
  )
    redirect("/welcome/plan");

  // raising Team Leaders file their team's OPENS plan the same way (v22) —
  // it IS the team goal; editable later from the profile "My plan" card
  if (
    !skipped &&
    viewer.profile_completed_at &&
    !viewer.impersonated &&
    (await needsTlPlan(viewer))
  )
    redirect("/welcome/plan-tl");

  const raising = hasRaisingAccess(viewer);
  const tm = hasTmAccess(viewer);
  // the OGX workspace (v25): OGT/OGV crews live in /signups
  const ogx = hasOgxAccess(viewer);
  // B2C CIC (v33.29): the B2C crew enters /signups for the CIC queue they
  // sell into — both OGX sides, read through their own gate server-side
  const b2cCic = isB2C(viewer);
  // the Consideration module (v26): IR calls + the CV pool
  const consideration = hasConsiderationAccess(viewer);
  const membership = canManageMembership(viewer);
  const planning = canSeePlanning(viewer);
  // OGT & OGV VPs/Directors (+ LCP/admin): the Expectation-Setting mail composer
  const ogtMail =
    viewer.isAdmin ||
    viewer.role === "LCP" ||
    ((viewer.role === "LCVP" || viewer.role === "Director") &&
      ["OGT", "OGV"].some(
        (f) => viewer.functions.includes(f) || viewer.sub_functions.includes(f)
      ));
  // routes a non-raising member still gets: their TM module, the membership
  // editor for EB members of other functions (e.g. an OGX LCVP), and the
  // planning board for OGX VPs/Directors
  // the calendar belongs to every module member now (touch points, v29)
  const calendar = raising || consideration || ogx || tm;
  // /dashboard = anyone who owns at least one LANE there — raising (ICX / B2B /
  // B2C), OGX (the OGT & OGV sign-up funnels, v28) or Consideration (the split
  // IR-call lanes, v29). Mirrors how dashboard/page.tsx builds `views`, so the
  // tab never leads someone to an empty page.
  // v32: the LC-wide overseers (TM & F&L leadership) own no module of their
  // own but read EVERY lane, so the tab has to exist for them too.
  // v33.17: TM core (incl. TM's TLs/Coordinators) gained the TM lane
  const dashboard =
    raising || ogx || consideration || seesEveryLane(viewer) || isTmCore(viewer);
  const extraRoutes = [
    ...(calendar ? ["/calendar"] : []),
    ...(tm ? ["/members"] : []),
    ...(membership ? ["/membership"] : []),
    ...(planning ? ["/planning"] : []),
    ...(ogx || b2cCic ? ["/signups"] : []),
    ...(consideration ? ["/consideration"] : []),
    ...(dashboard ? ["/dashboard"] : []),
    ...(ogtMail ? ["/ogt-mail"] : []),
  ];
  // v29: /attendance belongs to EVERY member, module or not — but it must not
  // count as "having a module" (that flag is what decides Soon vs bounce-home,
  // and a module-less viewer bouncing home would loop through "/" → /accounts)
  // v33.24 — the Emails tab is MMs and above, module or not: writing to a
  // partner is part of every MM's job. It rides the gate like /attendance.
  const mailbox = canUseMailboxTab(viewer);
  const gateRoutes = ["/attendance", ...(mailbox ? ["/emails"] : []), ...extraRoutes];

  // THE GRANT NUDGE (v33.40): an AIESEC email exists on the row but no Google
  // grant does — the member signed in before the address landed and has been
  // working without calendar/Gmail powers ever since, silently. One cheap
  // read; never in a test view (the grant is the real person's to give).
  let needsGoogleGrant = false;
  if (viewer.email && !viewer.impersonated) {
    const { data: row } = await db()
      .from("members")
      .select("google_refresh_token")
      .eq("id", viewer.id)
      .maybeSingle<{ google_refresh_token: string | null }>();
    needsGoogleGrant = !!row && !row.google_refresh_token;
  }

  // the test-view pool: `listViewAsTargets` already gates on the admin
  // capability and returns [] for everyone else (v33.42)
  const viewAsTargets = canUseAdminTools(viewer) ? await listViewAsTargets() : [];

  return (
    <AppShell
      viewAsTargets={viewAsTargets}
      user={{
        name: viewer.name,
        email: viewer.email ?? viewer.id,
        role: viewer.role,
        functions: viewer.functions,
        photoUrl: viewer.avatar_url || viewer.photo_url,
        isAdmin: viewer.isAdmin,
        adminTools: canUseAdminTools(viewer),
      }}
      nav={{
        calendar,
        raising,
        dashboard,
        tm,
        membership,
        planning,
        ogtMail,
        signups: ogx || b2cCic,
        consideration,
        mailbox,
      }}
      signOutAction={async () => {
        "use server";
        // a lingering test view must never survive into the next sign-in
        const { cookies } = await import("next/headers");
        const { VIEW_AS_COOKIE } = await import("@/server/data");
        (await cookies()).delete(VIEW_AS_COOKIE);
        await signOut({ redirectTo: "/login" });
      }}
    >
      {needsGoogleGrant ? <GoogleGrantBanner email={viewer.email!} /> : null}
      {raising ? (
        children
      ) : (
        <>
          <GateClient mode="allowed" extra={gateRoutes}>
            {children}
          </GateClient>
          <GateClient mode="soon" extra={gateRoutes} hasModule={extraRoutes.length > 0}>
            <ComingSoon functions={viewer.functions} />
          </GateClient>
        </>
      )}
      <Tour
        subFunctions={viewer.sub_functions}
        email={viewer.email ?? viewer.id}
        role={viewer.isAdmin && viewer.role !== "LCP" ? "LCP" : viewer.role}
        functions={viewer.functions}
        modules={{ raising, tm, ogx, consideration, calendar }}
      />
      {viewer.impersonated ? (
        <ViewAsBanner
          activeId={viewer.id}
          targets={viewAsTargets.length > 0 ? viewAsTargets : await listViewAsTargets()}
          mode={viewer.sandbox ? "sandbox" : "real"}
        />
      ) : null}
    </AppShell>
  );
}
