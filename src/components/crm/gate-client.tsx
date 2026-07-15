"use client";

import { usePathname } from "next/navigation";

/** Routes every member keeps even when their module isn't live yet. */
const ALWAYS_ALLOWED = ["/profile", "/feedback"];

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
