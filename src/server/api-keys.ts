import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/supabase";

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
}

/** null = no such live key. Stamps usage on success, best-effort: a failed
 *  stamp must never turn a good request into a 401. */
export async function verifyApiKey(presented: string | null): Promise<VerifiedKey | null> {
  const key = (presented ?? "").trim();
  if (!key.startsWith("sodio_") || key.length < 20) return null;
  const h = hash(key);
  const { data, error } = await db()
    .from("api_keys")
    .select("id, label, key_hash, revoked_at")
    .eq("key_hash", h)
    .maybeSingle<{ id: string; label: string; key_hash: string; revoked_at: string | null }>();
  if (error || !data || data.revoked_at) return null;
  if (!sameHash(data.key_hash, h)) return null;

  void db()
    .rpc("bump_api_key_use", { key_id: data.id })
    .then(({ error: e }) => {
      if (e) console.warn("[api-keys] usage stamp failed:", e.message);
    });
  return { id: data.id, label: data.label };
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const { data, error } = await db()
    .from("api_keys")
    .select("id, label, prefix, created_at, last_used_at, request_count, revoked_at, created_by")
    .order("revoked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[api-keys] list failed:", error.message);
    return [];
  }
  return (data ?? []) as ApiKeyRow[];
}
