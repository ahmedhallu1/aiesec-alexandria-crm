import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMPORT_FIELDS,
  IMPORT_FUNCTIONS,
  appliesTo,
  exampleFor,
  importFieldsFor,
  importTemplateRows,
  isRequired,
  mapImportHeaders,
  matchFunction,
  matchOption,
  matchProduct,
  toCsv,
  type ImportFn,
} from "@/lib/import-columns";
import { ACCOUNT_TYPES, B2C_TYPES, IGV_PROJECTS, INDUSTRIES } from "@/lib/types";

/**
 * THE BULK IMPORT, PER FUNCTION.
 *
 * The screen was written for IGV and IGT and then reused by everyone: B2C
 * members were shown a Product column they have no product for and an
 * Industry column their accounts don't carry, and NO column for the one field
 * a B2C account can't exist without. This file is what keeps the columns, the
 * template, the header matcher and the validator saying the same thing.
 */

describe("which columns each function gets", () => {
  it("gives IGV its project and no product", () => {
    const keys = importFieldsFor(["IGV"]).map((f) => f.key);
    expect(keys).toContain("project");
    expect(keys).not.toContain("product");
    expect(keys).not.toContain("sub_product");
  });

  it("gives IGT its product and sub product, and no project", () => {
    const keys = importFieldsFor(["IGT"]).map((f) => f.key);
    expect(keys).toContain("product");
    expect(keys).toContain("sub_product");
    expect(keys).not.toContain("project");
  });

  it("gives B2C its Type and NOTHING it doesn't carry", () => {
    // the whole point: a B2C account has one Type, no industry, no product,
    // no project (v23)
    const keys = importFieldsFor(["B2C"]).map((f) => f.key);
    expect(keys).toContain("account_type");
    expect(keys).not.toContain("industry");
    expect(keys).not.toContain("product");
    expect(keys).not.toContain("project");
    expect(keys).not.toContain("sub_product");
  });

  it("gives B2B/BD the whole-ICX shape: type and industry, no product or project", () => {
    for (const fn of ["B2B", "BD"] as ImportFn[]) {
      const keys = importFieldsFor([fn]).map((f) => f.key);
      expect(keys, fn).toContain("account_type");
      expect(keys, fn).toContain("industry");
      expect(keys, fn).not.toContain("product");
      expect(keys, fn).not.toContain("project");
    }
  });

  it("unions the columns for someone who works two functions", () => {
    const keys = importFieldsFor(["IGV", "IGT"]).map((f) => f.key);
    expect(keys).toContain("project");
    expect(keys).toContain("product");
  });

  it("hides the Function column when there is no choice to make", () => {
    expect(importFieldsFor(["IGV"]).map((f) => f.key)).not.toContain("function");
    expect(importFieldsFor(["IGV", "B2B"]).map((f) => f.key)).toContain("function");
  });

  it("always offers name, phone, email and comment, whoever is importing", () => {
    for (const fn of IMPORT_FUNCTIONS) {
      const keys = importFieldsFor([fn]).map((f) => f.key);
      for (const universal of ["name", "phone", "email", "comment", "responsible"]) {
        expect(keys, `${fn} / ${universal}`).toContain(universal);
      }
    }
  });
});

describe("what each function REFUSES a row without", () => {
  // these mirror createAccount() — the server is the authority and re-checks
  // every row, so a disagreement here shows up as a row rejected after upload
  const REQUIRED: Record<ImportFn, string[]> = {
    IGV: ["name", "project"],
    IGT: ["name", "product"],
    B2B: ["name"],
    BD: ["name"],
    B2C: ["name", "account_type"],
  };

  for (const fn of IMPORT_FUNCTIONS) {
    it(`${fn} requires exactly ${REQUIRED[fn].join(" + ")}`, () => {
      const required = IMPORT_FIELDS.filter((f) => isRequired(f, fn)).map((f) => f.key);
      expect(required.sort()).toEqual(REQUIRED[fn].sort());
    });
  }

  it("never requires a field it doesn't even show", () => {
    for (const fn of IMPORT_FUNCTIONS) {
      for (const f of IMPORT_FIELDS) {
        if (isRequired(f, fn)) expect(appliesTo(f, fn), `${fn}/${f.key}`).toBe(true);
      }
    }
  });
});

describe("every column carries a worked example", () => {
  it("has a non-empty example and hint", () => {
    for (const f of IMPORT_FIELDS) {
      expect(f.example, f.key).toBeTruthy();
      expect(f.hint.length, f.key).toBeGreaterThan(10);
    }
  });

  it("uses examples that are VALID for the pick-list they demonstrate", () => {
    // an example the server would reject teaches people the wrong file
    for (const f of IMPORT_FIELDS) {
      if (f.kind !== "pick" || f.openList || !f.options) continue;
      for (const fn of IMPORT_FUNCTIONS) {
        if (!appliesTo(f, fn)) continue;
        if (f.key === "function") continue;
        const opts = f.options(fn);
        const ex = f.key === "account_type" && fn === "B2C" ? B2C_TYPES[0] : f.example;
        expect(matchOption(ex, opts), `${f.key} example "${ex}" for ${fn}`).not.toBeNull();
      }
    }
  });
});

describe("the example shown for a column", () => {
  it("gives B2C a Type from ITS list, not the ICX one", () => {
    // the bug this pins: the column guide printed field.example verbatim, so
    // a B2C member was shown "Company" — a value their own import refuses
    const type = IMPORT_FIELDS.find((f) => f.key === "account_type")!;
    expect(B2C_TYPES).toContain(exampleFor(type, "B2C") as (typeof B2C_TYPES)[number]);
    expect(ACCOUNT_TYPES).toContain(exampleFor(type, "B2B") as (typeof ACCOUNT_TYPES)[number]);
  });

  it("never shows an example a closed list would reject", () => {
    for (const fn of IMPORT_FUNCTIONS) {
      for (const f of importFieldsFor([fn])) {
        if (f.kind !== "pick" || f.openList || !f.options || f.key === "function") continue;
        if (!appliesTo(f, fn)) continue;
        const ex = exampleFor(f, fn);
        expect(matchOption(ex, f.options(fn)), `${f.key} example "${ex}" for ${fn}`).not.toBeNull();
      }
    }
  });

  it("is empty for a column the function doesn't have", () => {
    const project = IMPORT_FIELDS.find((f) => f.key === "project")!;
    expect(exampleFor(project, "B2C")).toBe("");
  });
});

describe("the downloadable template", () => {
  for (const fn of IMPORT_FUNCTIONS) {
    it(`${fn}'s template has one example cell per header, all valid`, () => {
      const { headers, example } = importTemplateRows([fn]);
      expect(example.length).toBe(headers.length);
      const fields = importFieldsFor([fn]);
      fields.forEach((f, i) => {
        if (!appliesTo(f, fn)) return;
        // every required column must actually be filled in the example row
        if (isRequired(f, fn)) expect(example[i], `${fn}/${f.key}`).toBeTruthy();
      });
    });
  }

  it("gives B2C a Type its own list accepts", () => {
    const { headers, example } = importTemplateRows(["B2C"]);
    const i = headers.indexOf("Type");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(B2C_TYPES).toContain(example[i] as (typeof B2C_TYPES)[number]);
  });

  it("writes one header line and one example line", () => {
    const { headers, example } = importTemplateRows(["IGV"]);
    const lines = toCsv([headers, example]).split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split(",")).toHaveLength(headers.length);
  });

  it("quotes cells that would otherwise split the row", () => {
    // a template that corrupts its own example row teaches the wrong file —
    // and members DO write commas in the comment column
    expect(toCsv([["Ali, Hana", "plain"]])).toBe('"Ali, Hana",plain');
    expect(toCsv([['He said "yes"']])).toBe('"He said ""yes"""');
    expect(toCsv([["two\nlines"]])).toBe('"two\nlines"');
    expect(toCsv([["nothing special"]])).toBe("nothing special");
  });
});

describe("reading somebody's actual file", () => {
  const igv = importFieldsFor(["IGV", "IGT"]);

  it("matches the headings people really write", () => {
    const m = mapImportHeaders(
      ["Account Name", "PHONE NUMBER", "E-mail", "Industry", "Owner", "Notes"],
      igv
    );
    expect([...m.values()]).toEqual([
      "name", "phone", "email", "industry", "responsible", "comment",
    ]);
  });

  it("claims each field only once when two columns could match", () => {
    // "Phone" and "Mobile" both match /phone|mobile/ — the second must not
    // silently overwrite the first
    const m = mapImportHeaders(["Name", "Phone", "Mobile"], igv);
    expect([...m.values()]).toEqual(["name", "phone"]);
  });

  it("ignores blank and unknown headers instead of guessing", () => {
    const m = mapImportHeaders(["Name", "", "Revenue 2025", "Email"], igv);
    expect([...m.values()]).toEqual(["name", "email"]);
  });

  it("does not confuse Product with Sub product", () => {
    const m = mapImportHeaders(["Name", "Sub Product", "Product"], igv);
    expect(m.get(1)).toBe("sub_product");
    expect(m.get(2)).toBe("product");
  });
});

describe("resolving written values", () => {
  it("finds a project however it was typed", () => {
    expect(matchOption("skill up!", IGV_PROJECTS)).toBe("Skill Up!");
    expect(matchOption("SKILL UP", IGV_PROJECTS)).toBe("Skill Up!");
    expect(matchOption("global classroom", IGV_PROJECTS)).toBe("Global Classroom");
  });

  it("returns null rather than a wrong guess", () => {
    expect(matchOption("", IGV_PROJECTS)).toBeNull();
    expect(matchOption("Underwater Basket Weaving", IGV_PROJECTS)).toBeNull();
  });

  it("reads GTa/GTe from words or codes", () => {
    expect(matchProduct("GTa")).toBe("GTa");
    expect(matchProduct("global talent")).toBe("GTa");
    expect(matchProduct("Teacher")).toBe("GTe");
    expect(matchProduct("gte")).toBe("GTe");
    expect(matchProduct("something else")).toBe("");
  });

  it("resolves a function only when the member may use it", () => {
    expect(matchFunction("IGV", ["IGV", "IGT"])).toBe("IGV");
    // a file naming a function they don't work must NOT sneak through
    expect(matchFunction("B2C", ["IGV", "IGT"])).toBeNull();
    expect(matchFunction("igt raising", ["IGT"])).toBe("IGT");
  });

  it("keeps BD and B2B apart", () => {
    expect(matchFunction("BD", IMPORT_FUNCTIONS)).toBe("BD");
    expect(matchFunction("B2B", IMPORT_FUNCTIONS)).toBe("B2B");
    expect(matchFunction("b2b/bd", IMPORT_FUNCTIONS)).toBe("B2B");
  });

  it("accepts the real pick-lists it advertises", () => {
    expect(matchOption("company", ACCOUNT_TYPES)).toBe("Company");
    expect(matchOption("marketing", INDUSTRIES)).toBe("Marketing");
    expect(matchOption("student activities", B2C_TYPES)).toBe("Student activities");
  });
});

describe("the spec agrees with the server", () => {
  // createAccount is the authority. If someone changes a rule there and not
  // here, members get rows rejected after upload with no warning on screen —
  // so read the real source and check the three rules it enforces.
  const actions = readFileSync(join(process.cwd(), "src/server/actions.ts"), "utf8");

  it("still refuses IGT without a product, IGV without a project, B2C without a type", () => {
    expect(actions).toMatch(/data\.function === "IGT" && !data\.product/);
    expect(actions).toMatch(/data\.function === "IGV" && !data\.project/);
    expect(actions).toMatch(/data\.function === "B2C" &&[\s\S]{0,120}B2C_TYPES/);
  });

  it("covers every function the server accepts", () => {
    const enumLine = /function: z\.enum\(\[([^\]]+)\]\)/.exec(actions);
    expect(enumLine, "createAccountSchema's function enum moved").not.toBeNull();
    const serverFns = [...enumLine![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect([...IMPORT_FUNCTIONS].sort()).toEqual(serverFns.sort());
  });
});
