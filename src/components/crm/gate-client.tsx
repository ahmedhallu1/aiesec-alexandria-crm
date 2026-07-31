"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Routes every member keeps even when their module isn't live yet —
 *  the playbook is the manual of the whole LC, everyone can read it, and
 *  LC feedback (about people) is for the whole LC by design. */
const ALWAYS_ALLOWED = ["/profile", "/feedback", "/playbook", "/lc-feedback"];

/** Client-side switch used by the (app) layout for members whose function has
 *  no module: allowed routes render normally, everything else shows "Soon".
 *  `hasModule` (v27): someone with ANY live module never sees Soon — an
 *  off-limits route just bounces them home to their own workspace.
 *  NOTE: cosmetic only — pages with sensitive data must ALSO gate server-side. */
export function GateClient({
  mode,
  extra = [],
  hasModule = false,
  children,
}: {
  mode: "allowed" | "soon";
  extra?: string[];
  hasModule?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = [...ALWAYS_ALLOWED, ...extra].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  const bounce = !allowed && hasModule;
  useEffect(() => {
    if (mode === "soon" && bounce) router.replace("/");
  }, [mode, bounce, router]);
  if (mode === "allowed") return allowed ? <>{children}</> : null;
  if (bounce) return null; // redirecting home — never flash the Soon screen
  return allowed ? null : <>{children}</>;
}
