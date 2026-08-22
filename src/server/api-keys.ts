import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/supabase";
import type { ApiFields } from "@/lib/api-scope";

/** NAMED, REVOCABLE KEYS FOR THE READ-ONLY ACCOUNTS ENDPOINT.
 *
 *  One key per tool or person, so a key can be killed without breaking every
 *  other integration, and the row says which key pulled what and when.
 *
 *  The key is never stored. Only a SHA-256 of it, plus a short prefix so a
 *  human can tell two keys apart in the admin list — so losing the database
 *  does not hand anyone a working key. It is shown ONCE, at creation, and
 *  cannot be recovered afterwards; that is the point, not an oversight. */

export interface ApiKeyRow {
  id: string;
  label: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  revoked_at: string | null;
  created_by: string | null;
  functions: string[];
  fields: ApiFields;
  include_archived: boolean;
  expires_at: string | null;
  rate_per_hour: number;
}

const hash = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

/** `sodio_` + 40 hex. The prefix shown in the admin list is the first 14. */
export function mintKey(): { key: string; keyHash: string; prefix: string } {
  const key = `sodio_${randomBytes(20).toString("hex")}`;
  return { key, keyHash: hash(key), prefix: key.slice(0, 14) };
}

/** Constant-time compare of the presented key's hash against a stored one.
 *  The lookup is by hash (indexed), so this guards the final comparison only —
 *  but a string === on a secret is the kind of thing that ages badly. */
function sameHash(a: string, b: string): boolean {
  const A = Buffer.from(a, "utf8");
  const B = Buffer.from(b, "utf8");
  return A.length === B.length && timingSafeEqual(A, B);
}

export interface VerifiedKey {
  id: string;
  label: string;
  functions: string[];
  fields: ApiFields;
  includeArchived: boolean;
  ratePerHour: number;
}

/** Why a key was refused — the caller gets told, because "401" with no reason
 *  is how an integration silently rots. */
export type KeyRefusal = "unknown" | "revoked" | "expired";

/** null = no such live key. Stamps usage on success, best-effort: a failed
 *  stamp must never turn a good request into a 401. */
export async function verifyApiKey(
  presented: string | null
): Promise<VerifiedKey | KeyRefusal> {
  const key = (presented ?? "").trim();
  if (!key.startsWith("sodio_") || key.length < 20) return "unknown";
  const h = hash(key);
  const { data, error } = await db()
    .from("api_keys")
    .select(
      "id, label, key_hash, revoked_at, expires_at, functions, fields, include_archived, rate_per_hour"
    )
    .eq("key_hash", h)
    .maybeSingle<{
      id: string; label: string; key_hash: string; revoked_at: string | null;
      expires_at: string | null; functions: string[] | null; fields: ApiFields;
      include_archived: boolean; rate_per_hour: number;
    }>();
  if (error || !data) return "unknown";
  if (!sameHash(data.key_hash, h)) return "unknown";
  if (data.revoked_at) return "revoked";
  if (data.expires_at && new Date(data.expires_at) <= new Date()) return "expired";

  void db()
    .rpc("bump_api_key_use", { key_id: data.id })
    .then(({ error: e }) => {
      if (e) console.warn("[api-keys] usage stamp failed:", e.message);
    });
  return {
    id: data.id,
    label: data.label,
    functions: data.functions ?? [],
    fields: data.fields,
    includeArchived: data.include_archived,
    ratePerHour: data.rate_per_hour,
  };
}

/** Per-key hourly ceiling. This endpoint runs on a Hobby plan already at its
 *  CPU ceiling, so a key that polls in a loop is the whole LC's problem —
 *  atomic via the same bucket RPC the public booking page uses. */
export async function overRateLimit(key: VerifiedKey): Promise<boolean> {
  const hourKey = `apirl:${key.id}:${new Date().toISOString().slice(0, 13)}`;
  const { data, error } = await db().rpc("bump_rate_bucket", { k: hourKey });
  if (error) {
    console.warn("[api-keys] rate bucket failed, allowing:", error.message);
    return false; // fail OPEN — a broken counter must not take the API down
  }
  return typeof data === "number" && data > key.ratePerHour;
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const { data, error } = await db()
    .from("api_keys")
    .select(
      "id, label, prefix, created_at, last_used_at, request_count, revoked_at, created_by, " +
        "functions, fields, include_archived, expires_at, rate_per_hour"
    )
    .order("revoked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[api-keys] list failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as ApiKeyRow[];
}
