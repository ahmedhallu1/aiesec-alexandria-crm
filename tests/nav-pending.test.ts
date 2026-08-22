import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/** CLICKING SOMETHING MUST LOOK LIKE IT DID SOMETHING.
 *
 *  Every list view in Sodio drives its state through the URL, so a filter, a
 *  tab or a help topic is a NAVIGATION. The house pattern is:
 *
 *      const [navPending, startNav] = useTransition();
 *      startNav(() => router.replace(...));
 *      <div className={cn("…", navPending && "nav-pending")}>
 *
 *  The help centre shipped as `const [, startNav]` — the transition ran and the
 *  pending flag was thrown away, so opening a topic looked like a dead click on
 *  a slow connection. It is one character's difference and invisible in review,
 *  which is exactly the kind of thing that comes back. These two rules pin it.
 */
const DIR = join(process.cwd(), "src/components/crm");
const navigates = (src: string) => /router\.(push|replace)\(/.test(src);

/** Post-submit redirects are NOT filter navigation: the dialog that fired them
 *  already shows its own submitting state and a toast. Each exception needs a
 *  reason, so the list cannot quietly grow. */
const NOT_A_FILTER_NAV: Record<string, string> = {
  "account-detail-view.tsx":
    "only navigates after a rename, from a dialog with its own pending state",
};

const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));

describe("navigation always shows that it is happening", () => {
  it("no component starts a transition, navigates, and throws the pending flag away", () => {
    const guilty: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(DIR, f), "utf8");
      if (!navigates(src)) continue;
      // `const [, startX] = useTransition()` — the flag is discarded
      if (/const\s*\[\s*,\s*\w+\s*\]\s*=\s*useTransition\(\)/.test(src)) guilty.push(f);
    }
    expect(guilty, `these navigate but discard useTransition's pending flag: ${guilty.join(", ")}`)
      .toEqual([]);
  });

  it("every view that navigates renders the nav-pending shimmer", () => {
    const missing: string[] = [];
    for (const f of files) {
      if (!f.endsWith("-view.tsx")) continue;
      if (f in NOT_A_FILTER_NAV) continue;
      const src = readFileSync(join(DIR, f), "utf8");
      if (navigates(src) && !src.includes("nav-pending")) missing.push(f);
    }
    expect(missing, `these views navigate with no loading feedback: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("the rule covers a real set of views, so it cannot silently match nothing", () => {
    const covered = files.filter(
      (f) =>
        f.endsWith("-view.tsx") &&
        navigates(readFileSync(join(DIR, f), "utf8")) &&
        !(f in NOT_A_FILTER_NAV)
    );
    expect(covered.length).toBeGreaterThanOrEqual(8);
  });
});
