import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getViewer, listViewAsTargets, needsMmPlan, needsTlPlan } from "@/server/data";
import { PLAN_SKIP_COOKIE } from "@/lib/plan-skip";
import { prankIsOn } from "@/lib/types";
import { canUseAdminTools } from "@/lib/rbac";
import { homeFor, navFlagsFor } from "@/lib/home-options";
import { tabRules } from "@/server/tabs";
import { tabOverridesFor } from "@/lib/tabs";
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

  // the code's answer per module — ONE function (lib/home-options.ts) shared
  // with "/", the logo and the home picker, so they can never disagree
  const nav = navFlagsFor(viewer);
  const { raising, tm, ogx, consideration, calendar } = nav;
  // v38 — THE TAB MANAGER's rules for this person (Settings → Tabs). A tab
  // they are shown by a rule joins the gate's routes; a hidden one is cut
  // from the sidebar here and refused by its page (`tabAllows`).
  const rules = await tabRules();
  const tabOverrides = tabOverridesFor(rules, viewer);
  const tabLabels = Object.fromEntries(
    rules.filter((r) => r.label).map((r) => [r.href, r.label as string])
  );
  const tabPositions = Object.fromEntries(
    rules.filter((r) => r.position !== null).map((r) => [r.href, r.position as number])
  );
  // routes a non-raising member still gets: their TM module, the membership
  // editor for EB members of other functions (e.g. an OGX LCVP), and the
  // planning board for OGX VPs/Directors
  const extraRoutes = [
    ...(nav.calendar ? ["/calendar"] : []),
    ...(nav.tm ? ["/members"] : []),
    ...(nav.membership ? ["/membership"] : []),
    ...(nav.planning ? ["/planning"] : []),
    ...(nav.signups ? ["/signups"] : []),
    ...(nav.consideration ? ["/consideration"] : []),
    ...(nav.cxp ? ["/cxp"] : []),
    ...(nav.dashboard ? ["/dashboard"] : []),
    // the Expectation mail is a button inside Emails — it goes where the
    // Emails tab goes (v38.3: a hidden Emails tab takes it along)
    ...(nav.ogtMail && tabOverrides["/emails"] !== "hide" ? ["/ogt-mail"] : []),
  ];
  // v29: /attendance belongs to EVERY member, module or not — but it must not
  // count as "having a module" (that flag is what decides Soon vs bounce-home).
  // Emails (v33.24), the Activate 26' bid (v36.8) and the War Room (v38) ride
  // the gate the same way.
  const gateRoutes = [
    "/attendance",
    ...(nav.mailbox ? ["/emails"] : []),
    ...(nav.activation ? ["/activation"] : []),
    ...(nav.warRoom ? ["/war-room"] : []),
    ...extraRoutes,
    ...Object.keys(tabOverrides).filter((h) => tabOverrides[h] === "show"),
  ];
  // "having a module" counts only what they can still SEE (v38.3): a module
  // the LC's rules hide is not one, and a tab a rule opens to them is
  const hasModule =
    extraRoutes.some((h) => tabOverrides[h] !== "hide") ||
    Object.values(tabOverrides).includes("show");
  // where "/", the logo and the gate's bounce all land
  const home = homeFor(viewer, tabOverrides, nav);

  // THE GRANT NUDGE (v33.40): an AIESEC email exists on the row but no Google
  // grant does — the member signed in before the address landed and has been
  // working without calendar/Gmail powers ever since, silently. Never in a
  // test view (the grant is the real person's to give).
  //
  // v33.59 — THE QUERY IS GONE. This was "one cheap read", which is true of
  // one read and false of one read on every page view of every member for a
  // month: it was the app's second-hottest query. And it asked for a column
  // the Viewer already carries — `getViewerByEmail` selects `*` from the same
  // row, in the same request, a few lines above. Same value, no round trip.
  const needsGoogleGrant =
    !!viewer.email && !viewer.impersonated && !viewer.google_refresh_token;

  // the test-view pool: `listViewAsTargets` already gates on the admin
  // capability and returns [] for everyone else (v33.42)
  const viewAsTargets = canUseAdminTools(viewer) ? await listViewAsTargets() : [];

  // 🃏 PRANK MODE (v33.51) — off in a TEST VIEW on purpose: an admin looking
  // at somebody's screen to diagnose it must see the real thing, and pranking
  // yourself-as-them proves nothing. `prankIsOn` is the one expiry rule.
  const prankOn = prankIsOn(viewer) && !viewer.impersonated;
  let prankBy: string | null = null;
  if (prankOn && viewer.prank_by) {
    const { data: author } = await db()
      .from("members")
      .select("name")
      .eq("id", viewer.prank_by)
      .maybeSingle<{ name: string }>();
    prankBy = author?.name ?? null;
  }

  return (
    <AppShell
      prank={{ on: prankOn, by: prankBy }}
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
        dashboard: nav.dashboard,
        tm,
        membership: nav.membership,
        planning: nav.planning,
        ogtMail: nav.ogtMail,
        signups: nav.signups,
        consideration,
        mailbox: nav.mailbox,
        cxp: nav.cxp,
        activation: nav.activation,
        warRoom: nav.warRoom,
      }}
      homeHref={home}
      tabs={{ overrides: tabOverrides, labels: tabLabels, positions: tabPositions }}
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
          <GateClient mode="soon" extra={gateRoutes} hasModule={hasModule} home={home}>
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
        // v36.6 — remembered per MEMBER, not per browser (src/lib/tour-state.ts)
        seen={!!viewer.tour_seen_at}
        impersonated={!!viewer.impersonated}
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
