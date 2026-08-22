/** WHAT AN API KEY MAY READ — shared by the server that enforces it and the
 *  admin card that issues it. It lives in lib/ and NOT in server/api-keys.ts
 *  because that module is `server-only`, and a client component importing a
 *  VALUE from it breaks the build (a type-only import would have been fine —
 *  this one is a real object). */
export type ApiFields = "names" | "pipeline" | "contacts";

export const API_FIELDS: ApiFields[] = ["names", "pipeline", "contacts"];

export const API_FIELD_LABEL: Record<ApiFields, string> = {
  names: "Names only — enough to dedupe, and nothing else",
  pipeline: "Names + stage, product, owner and dates",
  contacts: "Everything, including phones, emails and links",
};

/** The account functions a key can be scoped to. */
export const API_FUNCTIONS = ["IGV", "IGT", "B2B", "BD", "B2C"] as const;
