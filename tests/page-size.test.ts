import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageSizeOf } from "@/lib/page-size";

/** "I PICK 100 A PAGE AND IT STAYS ON 20" (the CIC queue, v37).
 *
 *  The sign-ups picker dropped `?size` from the URL whenever 100 was chosen,
 *  because 100 USED to be the default. v33.10 made it 20, and the literal was
 *  never updated — so the one size people picked most was the one that could
 *  not be picked. A picker may only omit `?size` for the REAL default, and the
 *  only way to say that is the shared constant. */
describe("rows per page", () => {
  it("round-trips every size the pickers offer", () => {
    for (const n of PAGE_SIZES) expect(pageSizeOf(String(n))).toBe(n);
    expect(pageSizeOf(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(pageSizeOf("10000")).toBe(DEFAULT_PAGE_SIZE);
  });

  it("no table compares a page size to a hard-coded number", () => {
    const dir = join(process.cwd(), "src/components/crm");
    const guilty: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(join(dir, f), "utf8");
      // `size: n === 100 ? null : …` / `setParam("size", n === 20 ? "" : …)`
      // — a size param decided by a literal (plurals like `n === 1 ? "" : "s"`
      // are not page sizes, hence the "size" anchor)
      // (and `picked.size === 1 ? "" : "s"` is a plural — page sizes are 2+ digits)
      if (/size[^\n]{0,40}===\s*\d{2,}\s*\?\s*(null|""|'')/i.test(src)) guilty.push(f);
    }
    expect(guilty).toEqual([]);
  });
});
