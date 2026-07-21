"use client";

import { usePathname } from "next/navigation";

/** Routes every member keeps even when their module isn't live yet —
 *  the playbook is the manual of the whole LC, everyone can read it, and
 *  LC feedback (about people) is for the whole LC by design. */
const ALWAYS_ALLOWED = ["/profile", "/feedback", "/playbook", "/lc-feedback"];

/** Client-side switch used by the (app) layout for members whose function has
 *  no module: allowed routes render normally, everything else shows "Soon".
 *  `extra` adds per-viewer route prefixes (e.g. /members for the TM crew).
 *  NOTE: cosmetic only — pages with sensitive data must ALSO gate server-side. */
export function GateClient({
  mode,
  extra = [],
  children,
}: {
  mode: "allowed" | "soon";
  extra?: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const allowed = [...ALWAYS_ALLOWED, ...extra].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (mode === "allowed") return allowed ? <>{children}</> : null;
  return allowed ? null : <>{children}</>;
}
