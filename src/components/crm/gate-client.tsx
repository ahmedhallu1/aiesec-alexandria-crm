"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Routes every member keeps even when their module isn't live yet —
 *  the playbook is the manual of the whole LC, everyone can read it, and
 *  LC feedback (about people) is for the whole LC by design.
 *  "/" MUST be allowed (v28): the home page is a pure redirect-by-module —
 *  if the gate returns null there, the page's redirect() never renders on a
 *  client navigation and non-raising viewers get a BLANK screen (and the
 *  "soon" gate's bounce-to-"/" would loop). "/" matches exactly, never as a
 *  prefix. */
/** v36 — /pdp joins them. A development plan is not a module: every member of
 *  the LC has one filed for them, whatever function they are in and whether or
 *  not that function's CRM module exists yet. Gating it behind a module would
 *  hide somebody's own plan from them — which is precisely the half of this
 *  process the Google Sheets already failed to give a member, since the sheet
 *  lived in their leader's Drive. The PAGE still gates server-side. */
const ALWAYS_ALLOWED = [
  "/", "/profile", "/feedback", "/help", "/playbook", "/lc-feedback", "/pdp",
  // (/activation is NOT here since v36.8 — the bid is MMs and above, so the
  // layout adds it to `extra` for exactly them)
];

/** Client-side switch used by the (app) layout for members whose function has
 *  no module: allowed routes render normally, everything else shows "Soon".
 *  `hasModule` (v27): someone with ANY live module never sees Soon — an
 *  off-limits route just bounces them home to their own workspace.
 *  v38.3: the bounce goes straight to `home` (the layout's `homeRouteFor`),
 *  not to "/": "/" redirecting to a route this gate bounces again left the
 *  pathname unchanged, so the effect never re-ran and the page stayed blank.
 *  And never to the page they are already on.
 *  NOTE: cosmetic only — pages with sensitive data must ALSO gate server-side. */
export function GateClient({
  mode,
  extra = [],
  hasModule = false,
  home = "/",
  children,
}: {
  mode: "allowed" | "soon";
  extra?: string[];
  hasModule?: boolean;
  home?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = [...ALWAYS_ALLOWED, ...extra].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  const bounce = !allowed && hasModule && pathname !== home;
  useEffect(() => {
    if (mode === "soon" && bounce) router.replace(home);
  }, [mode, bounce, router, home]);
  if (mode === "allowed") return allowed ? <>{children}</> : null;
  if (bounce) return null; // redirecting home — never flash the Soon screen
  return allowed ? null : <>{children}</>;
}
