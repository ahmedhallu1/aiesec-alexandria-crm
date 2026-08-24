/** WHAT THE IMPORT ASKS FOR, DECIDED BY WHO IS ASKING (v34.8).
 *
 *  THE PROBLEM THIS SOLVES: the import screen was written for IGV and IGT and
 *  then quietly reused by everyone. A B2C member was shown a Product column
 *  they have no product for, an "Industry / Sub product" column B2C accounts
 *  do not carry at all, and NO column for the one field a B2C account cannot
 *  be created without — its Type. The header line under the upload box listed
 *  "Function (IGV/IGT)" to a BD crew, and the worked example every member
 *  needed most simply did not exist. So people guessed at the file, the rows
 *  came back rejected one at a time, and the feature got a reputation.
 *
 *  The fix is to describe the columns ONCE, per function, with an example on
 *  every one — and then let the screen, the downloadable template, the header
 *  matcher and the row validator all read that single description. A field
 *  cannot then appear in the table but be missing from the template, or be
 *  demanded by the server but never asked for on screen.
 *
 *  ⚠️ These rules mirror `createAccount` in server/actions.ts, which is the
 *  authority — the server re-validates every row regardless. `tests/
 *  import-columns.test.ts` pins them against it. When a function's rules
 *  change there, change them here in the same commit.
 */

import {
  ACCOUNT_TYPES, B2C_TYPES, IGT_SUB_PRODUCTS, IGV_PROJECTS, INDUSTRIES,
} from "@/lib/types";

export type ImportFn = "IGV" | "IGT" | "B2B" | "BD" | "B2C";
export const IMPORT_FUNCTIONS: readonly ImportFn[] = ["IGV", "IGT", "B2B", "BD", "B2C"];

export type ImportFieldKey =
  | "name" | "function" | "product" | "project" | "sub_product"
  | "account_type" | "industry" | "phone" | "email"
  | "social_link" | "website" | "comment" | "responsible";

export interface ImportField {
  key: ImportFieldKey;
  /** the column heading written into the template, and shown in the table */
  label: string;
  /** which functions this column exists for. "all" = every one. */
  appliesTo: readonly ImportFn[] | "all";
  /** which functions REFUSE a row without it. */
  requiredFor: readonly ImportFn[];
  kind: "text" | "pick" | "phone" | "email" | "url" | "member";
  /** the values a "pick" column accepts, per function */
  options?: (fn: ImportFn) => readonly string[];
  /** free text is allowed alongside the options (industries, sub products) */
  openList?: boolean;
  /** A REAL example, not a description of one. This is the single thing that
   *  most reduces a rejected row: people copy the shape they can see. */
  example: string;
  /** one line under the column, in the template's second sheet and the help */
  hint: string;
  /** loose header matching so "Account Name", "company", "الاسم" all land */
  match: RegExp;
}

/** Every column the importer knows about, in the order a file should carry
 *  them: identity first, then what the function needs, then how to reach
 *  them, then the extras. */
export const IMPORT_FIELDS: readonly ImportField[] = [
  {
    key: "name",
    label: "Name",
    appliesTo: "all",
    requiredFor: IMPORT_FUNCTIONS,
    kind: "text",
    example: "Hadana Moves",
    hint: "The company or place, exactly as you'd write it on Podio. Must be unique — duplicates and archived names are blocked.",
    match: /^(account\s*)?name$|company|الاسم/i,
  },
  {
    key: "function",
    label: "Function",
    // only worth a column when the member can actually import into more than
    // one — otherwise it is a single-option control asking a settled question
    appliesTo: "all",
    requiredFor: [],
    kind: "pick",
    options: () => IMPORT_FUNCTIONS,
    example: "IGV",
    hint: "Leave it out and every row lands in your own function. Rows naming a function you don't work are pulled back to yours.",
    match: /^function$|^fn$/i,
  },
  {
    key: "product",
    label: "Product",
    appliesTo: ["IGT"],
    requiredFor: ["IGT"],
    kind: "pick",
    options: () => ["GTa", "GTe"],
    example: "GTa",
    hint: "GTa = Global Talent · GTe = Global Teacher. Words work too: “talent”, “teacher”.",
    match: /^product$/i,
  },
  {
    key: "project",
    label: "Project",
    appliesTo: ["IGV"],
    requiredFor: ["IGV"],
    kind: "pick",
    options: () => IGV_PROJECTS,
    example: "Skill Up!",
    hint: "Every IGV account belongs to a project.",
    match: /^project$/i,
  },
  {
    key: "account_type",
    // B2C's ONE required field, and it is not the same question as an ICX
    // account type — different list, different name on screen
    label: "Type",
    appliesTo: ["IGV", "B2B", "BD", "B2C"],
    requiredFor: ["B2C"],
    kind: "pick",
    options: (fn) => (fn === "B2C" ? B2C_TYPES : ACCOUNT_TYPES),
    example: "Company",
    hint: "What the business IS.",
    match: /account\s*type|^type$/i,
  },
  {
    key: "industry",
    label: "Industry",
    // B2C accounts carry a Type and nothing else (v23) — an Industry column
    // on a B2C import wrote a field the account is not supposed to have
    appliesTo: ["IGV", "B2B", "BD"],
    requiredFor: [],
    kind: "pick",
    openList: true,
    options: () => INDUSTRIES,
    example: "Marketing",
    hint: "The domain it works in. Anything not on the list is kept as you typed it.",
    match: /industry|مجال/i,
  },
  {
    key: "sub_product",
    label: "Sub product",
    appliesTo: ["IGT"],
    requiredFor: [],
    kind: "pick",
    openList: true,
    options: () => IGT_SUB_PRODUCTS,
    example: "Software",
    hint: "IGT's version of the industry question. Optional.",
    match: /sub\s*[-_ ]?product/i,
  },
  {
    key: "phone",
    label: "Phone",
    appliesTo: "all",
    requiredFor: [],
    kind: "phone",
    example: "01012345678",
    hint: "Egyptian mobiles and landlines are normalised for you (+20…). Anything foreign needs its full country code.",
    match: /phone|number|mobile|whats\s*app|تليفون|رقم/i,
  },
  {
    key: "email",
    label: "Email",
    appliesTo: "all",
    requiredFor: [],
    kind: "email",
    example: "info@hadana.com",
    hint: "One address. More contacts can be added on the account afterwards.",
    match: /e-?mail|ايميل/i,
  },
  {
    key: "website",
    label: "Website",
    appliesTo: "all",
    requiredFor: [],
    kind: "url",
    example: "https://hadana.com",
    hint: "Must start with http:// or https:// — a bare “hadana.com” is rejected.",
    match: /website|^site$|^url$/i,
  },
  {
    key: "social_link",
    label: "Social link",
    appliesTo: "all",
    requiredFor: [],
    kind: "url",
    example: "https://instagram.com/hadana",
    hint: "Instagram, Facebook, LinkedIn — whichever page you actually found them on.",
    match: /social|instagram|facebook|linked\s*in/i,
  },
  {
    key: "comment",
    label: "Comment",
    appliesTo: "all",
    requiredFor: [],
    kind: "text",
    example: "Found on the Smouha branch list — ask for Mr. Tarek",
    hint: "Lands as the first comment on the account. Where you found them, who to ask for.",
    match: /comment|note|ملاحظ/i,
  },
  {
    key: "responsible",
    label: "Responsible",
    appliesTo: "all",
    requiredFor: [],
    kind: "member",
    example: "Hana Wael",
    hint: "The member's full name as it appears in Sodio. Leave it out and they're yours. Only leaders can assign to other people.",
    match: /responsible|owner|assigned|member/i,
  },
] as const;

/** THE COLUMNS THIS MEMBER SHOULD SEE.
 *
 *  A field survives when ANY function they may import into uses it, so a
 *  member who works both IGV and IGT is shown Project and Product, while a
 *  B2C-only member is shown Type and neither. The Function column only
 *  appears when there is a real choice to make. */
export function importFieldsFor(allowedFns: readonly ImportFn[]): ImportField[] {
  const fns = allowedFns.length > 0 ? allowedFns : IMPORT_FUNCTIONS;
  return IMPORT_FIELDS.filter((f) => {
    if (f.key === "function") return fns.length > 1;
    return f.appliesTo === "all" || f.appliesTo.some((fn) => fns.includes(fn));
  });
}

/** Does this function need this field before the server will take the row? */
export function isRequired(field: ImportField, fn: ImportFn): boolean {
  return field.requiredFor.includes(fn);
}

/** Does this field exist at all for this function? */
export function appliesTo(field: ImportField, fn: ImportFn): boolean {
  return field.appliesTo === "all" || field.appliesTo.includes(fn);
}

/** THE EXAMPLE FOR A GIVEN FUNCTION.
 *
 *  ⚠️ `field.example` alone is NOT safe to show: "Type" is one list for B2C
 *  (Courses / Events / Student activities) and another for everyone else
 *  (Company / Startup / School…), so a B2C member reading the column guide
 *  was being shown "Company" — a value their own import would refuse. The
 *  guide, the table placeholders and the downloadable template all resolve
 *  the example through here so they cannot disagree. */
export function exampleFor(field: ImportField, fn: ImportFn): string {
  if (!appliesTo(field, fn)) return "";
  if (field.key === "function") return fn;
  if (field.kind === "pick" && field.options && !field.openList) {
    const opts = field.options(fn);
    // keep the hand-written example when this function's own list has it;
    // otherwise show the first value that list actually offers
    if (matchOption(field.example, opts)) return field.example;
    return opts[0] ?? field.example;
  }
  return field.example;
}

/** Map a file's header row onto field keys. First match wins, and a field is
 *  only claimed once — two columns both matching /phone/ must not both become
 *  the phone. */
export function mapImportHeaders(
  headers: readonly string[],
  fields: readonly ImportField[]
): Map<number, ImportFieldKey> {
  const out = new Map<number, ImportFieldKey>();
  const taken = new Set<ImportFieldKey>();
  headers.forEach((h, i) => {
    const clean = String(h ?? "").trim();
    if (!clean) return;
    const hit = fields.find((f) => !taken.has(f.key) && f.match.test(clean));
    if (hit) {
      out.set(i, hit.key);
      taken.add(hit.key);
    }
  });
  return out;
}

/** Resolve a written value against a pick-list, tolerantly: case, spacing and
 *  punctuation are ignored, so "skill up" finds "Skill Up!". An open list
 *  keeps anything it can't place; a closed one reports it as unmatched. */
export function matchOption(
  value: string,
  options: readonly string[]
): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const v = norm(value);
  if (!v) return null;
  return (
    options.find((o) => norm(o) === v) ??
    options.find((o) => norm(o).startsWith(v) || v.startsWith(norm(o))) ??
    null
  );
}

/** GTa/GTe from whatever was typed. */
export function matchProduct(value: string): "GTa" | "GTe" | "" {
  const v = value.toLowerCase();
  if (v.includes("gta") || v.includes("talent")) return "GTa";
  if (v.includes("gte") || v.includes("teacher")) return "GTe";
  return "";
}

/** A function name from whatever was typed, restricted to what they may use.
 *  ⚠️ BD is tested BEFORE B2B: a plain `includes("B2B")` check running first
 *  is fine, but "BD" appears inside no other name while "B2B" does not
 *  contain "BD" — order them explicitly so neither can shadow the other. */
export function matchFunction(
  value: string,
  allowed: readonly ImportFn[]
): ImportFn | null {
  const v = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hit: ImportFn | null =
    v.includes("B2C") ? "B2C"
    : v.includes("B2B") ? "B2B"
    : v.includes("BD") ? "BD"
    : v.includes("IGV") || v === "GV" ? "IGV"
    : v.includes("IGT") || v === "GT" || v.includes("GTA") || v.includes("GTE") ? "IGT"
    : null;
  return hit && allowed.includes(hit) ? hit : null;
}

/** THE TEMPLATE FILE — the columns this member's file should have, with one
 *  worked example row underneath. "Organise the columns right" stops being
 *  guesswork when you can start from a file that already is. */
export function importTemplateRows(
  allowedFns: readonly ImportFn[]
): { headers: string[]; example: string[] } {
  const fields = importFieldsFor(allowedFns);
  const fn = allowedFns[0] ?? "IGV";
  return {
    headers: fields.map((f) => f.label),
    // the example has to be VALID for the function it demonstrates, or the
    // template teaches a row the server would reject
    example: fields.map((f) => exampleFor(f, fn)),
  };
}

/** CSV, quoted properly — an example like `Found them on the list, ask Tarek`
 *  contains a comma, and a template that corrupts its own example row is
 *  worse than none. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
