import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/** Server-only Supabase client using the service-role key.
 *  RLS blocks the anon key entirely; every query goes through this client and
 *  is authorized by the RBAC layer (src/lib/rbac.ts) before it runs. */
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }
  client ??= createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false },
  });
  return client;
}
