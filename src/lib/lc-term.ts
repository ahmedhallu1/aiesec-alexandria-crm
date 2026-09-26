// =============================================================================
// THE LC'S TERM & PEAK — the handover model (v37.2). Pure.
//
// A PEAK (six months) restarts the MEMBERSHIP — people leave, new ones join —
// but keeps the planning: the planning sheet is the TERM's (Feb → Jan).
// A TERM restarts both: a new planning sheet, and a new membership.
//
// What the LCP / admins record when they start one lives in app_settings
// `lc:term`; every past start is kept in `lc:term-history`.
// =============================================================================

export type LcPeriodKind = "peak" | "term";

export interface HandoverLink {
  label: string;
  url: string;
}

export interface Handover {
  /** for the whole EB: what the incoming team must know first */
  general: string;
  /** per function ("IGV", "OGT", "TM", …) — what that function's VP inherits */
  perFunction: Record<string, string>;
  /** the places people need: Drive folders, the planning sheet, EXPA, forms */
  links: HandoverLink[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface LcTermState {
  kind: LcPeriodKind;
  /** "26.27" */
  termLabel: string;
  /** "Winter peak (Aug 2026 – Jan 2027)" */
  peakLabel: string;
  startedAt: string;
  startedBy: string;
  /** a new term started before its planning sheet existed — remind until done */
  planningPending: boolean;
  /** manual handover checklist: id → done */
  checklist: Record<string, boolean>;
}

export const EMPTY_HANDOVER: Handover = {
  general: "",
  perFunction: {},
  links: [],
  updatedAt: null,
  updatedBy: null,
};

/** The things a handover needs that Sodio can't do by itself. Ticked by hand,
 *  so the next LCP opens the same list and sees what was actually done. */
export const HANDOVER_CHECKLIST: { id: string; label: string; hint: string; termOnly?: boolean }[] = [
  {
    id: "drive-access",
    label: "The new EB can open the CRM Drive folder",
    hint: "Share “AIESEC Alexandria CRM” with every incoming LCVP (commenter is enough).",
  },
  {
    id: "function-defaults",
    label: "Each VP has checked their function's defaults",
    hint: "Profile → Settings → My function: who sees the whole function, Podio cadence, OGX floor rules.",
  },
  {
    id: "google-signin",
    label: "New members told to sign in with Google once",
    hint: "Their first sign-in grants Sodio their calendar and Gmail (visit invites, proposals).",
  },
  {
    id: "cxp-subtool",
    label: "CXP reads this term's ECB SubTool",
    hint: "If the ECB issued a new SubTool, its mirror sheet id must be updated (CXP_SUBTOOL_SHEET_ID).",
    termOnly: true,
  },
  {
    id: "podio-links",
    label: "Podio forms and links still work",
    hint: "The national forms sometimes change at a new term — open one from an account to check.",
    termOnly: true,
  },
];

export const LC_FUNCTIONS_FOR_HANDOVER = [
  "IGV", "IGT", "B2B", "BD", "B2C", "OGV", "OGT", "TM", "F&L", "CXP", "IM", "MKT",
] as const;

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max = 8000) => (typeof x === "string" ? x.slice(0, max) : "");

/** A stored handover blob, cleaned — anything malformed becomes empty. */
export function resolveHandover(raw: unknown): Handover {
  if (!isObj(raw)) return { ...EMPTY_HANDOVER };
  const per: Record<string, string> = {};
  if (isObj(raw.perFunction)) {
    for (const [k, v] of Object.entries(raw.perFunction)) {
      const t = str(v).trim();
      if (t && k.length < 20) per[k] = t;
    }
  }
  const links = Array.isArray(raw.links)
    ? raw.links
        .filter(isObj)
        .map((l) => ({ label: str(l.label, 120).trim(), url: str(l.url, 600).trim() }))
        .filter((l) => l.label && /^https?:\/\//i.test(l.url))
        .slice(0, 30)
    : [];
  return {
    general: str(raw.general).trim(),
    perFunction: per,
    links,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
  };
}

/** "26.27" for the term that starts in February `febYear`. */
export function termLabelOf(febYear: number): string {
  const a = String(febYear % 100).padStart(2, "0");
  const b = String((febYear + 1) % 100).padStart(2, "0");
  return `${a}.${b}`;
}

/** A Google Sheets link or a bare id → the spreadsheet id, or null. */
export function spreadsheetIdFrom(input: string): string | null {
  const t = String(input ?? "").trim();
  const m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(t) ? t : null;
}
