import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** EVERY `<Link>` STAYS `prefetch={false}` (v33.59).
 *
 *  v33.58 root-caused the hosting bill to `<Link>` prefetching: in production
 *  Next prefetches every link that ENTERS THE VIEWPORT, and the sidebar puts a
 *  dozen on screen on every page — so one page view quietly fired a dozen RSC
 *  requests for routes nobody asked for, each one a full server render and a
 *  billable invocation. Measured in a real production build at the time: 12
 *  links with the default versus 12 with `prefetch={false}` gave 12 requests
 *  against 0.
 *
 *  It costs nothing in UX here, because every route in this app is dynamic and
 *  auth-gated: "auto" prefetch only ever fetched the shell down to the nearest
 *  `loading.tsx` — the skeleton the member sees on click anyway.
 *
 *  That fix is 30 one-word props spread across 20 files, which is exactly the
 *  kind of thing that comes back one careless `<Link>` at a time. This test is
 *  the ratchet. If you are adding a link that genuinely SHOULD prefetch, say
 *  so here rather than deleting the test.
 */

const SRC = join(import.meta.dirname, "..", "src");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Source with comments blanked out. Needed because this codebase EXPLAINS
 *  the prefetch rule in prose — app-shell.tsx's note contains the words
 *  "every <Link> that ENTERS THE VIEWPORT", which a scanner reading raw text
 *  reports as an offending link with no prefetch prop. Quotes are tracked so a
 *  `//` inside a URL string is not mistaken for a comment. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === quote) quote = null;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && next === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The opening tag of every next/link `<Link …>` in a file, whitespace
 *  collapsed — the props of ONE link, however many lines it is written over.
 *  A naive line-by-line grep gets this wrong: most links in this codebase put
 *  `href` and `prefetch` on their own lines, so the line holding `<Link` looks
 *  bare while the prop is two lines below it. */
function linkTags(source: string): string[] {
  const out: string[] = [];
  // `<Link` followed by a boundary, so <LinkedinIcon /> and <Link2 /> (the
  // lucide icons, which are not links at all) are never matched
  const re = /<Link(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    // walk to the end of the opening tag, ignoring `>` inside {…} or "…"
    let depth = 0;
    let quote: string | null = null;
    let i = m.index;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(source.slice(m.index, i + 1).replace(/\s+/g, " "));
  }
  return out;
}

describe("Link prefetching stays off", () => {
  const files = tsxFiles(SRC).filter((f) =>
    /from "next\/link"/.test(readFileSync(f, "utf8"))
  );
  const tagsOf = (file: string) => linkTags(stripComments(readFileSync(file, "utf8")));

  it("finds the files that use next/link at all", () => {
    // a guard on the guard: if the import moves or is wrapped, this test would
    // silently pass by checking nothing
    expect(files.length).toBeGreaterThan(10);
  });

  it("every <Link> carries prefetch={false}", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const tag of tagsOf(file)) {
        checked++;
        if (!/prefetch=\{false\}/.test(tag))
          offenders.push(`${file.slice(SRC.length + 1)}: ${tag.slice(0, 100)}`);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
