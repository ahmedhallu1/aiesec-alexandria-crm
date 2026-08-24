import "server-only";

/** READING A MEMBER'S OWN SETTINGS (v34.8).
 *
 *  Unlike the function defaults, these are NOT needed to build a Viewer — no
 *  page render depends on them. They are read on two kinds of path only:
 *
 *   · the settings panel itself, once, when someone opens their profile;
 *   · a FAN-OUT, where we already have a list of member ids and are about to
 *     email or bell them.
 *
 *  So the useful shape is a bulk read: "of these forty people, which ones
 *  still want this?" — one query per fan-out, not one per recipient.
 *
 *  ⚠️ THIS FAILS OPEN, and that is deliberate. If the read errors, everyone
 *  is treated as opted IN. The alternative — silently suppressing a fan-out
 *  because a query blipped — turns a database hiccup into "the LC stopped
 *  being told about visits", which is far worse than one unwanted email.
 */

import { db } from "@/lib/supabase";
import {
  MEMBER_SETTINGS_DEFAULTS, resolveMemberSettings, type MemberSettings,
} from "@/lib/member-settings";

interface Row {
  id: string;
  settings: unknown;
}

/** One member's resolved settings (defaults filled in). */
export async function memberSettings(memberId: string): Promise<MemberSettings> {
  const { data, error } = await db()
    .from("members")
    .select("settings")
    .eq("id", memberId)
    .maybeSingle<{ settings: unknown }>();
  if (error || !data) return { ...MEMBER_SETTINGS_DEFAULTS };
  return resolveMemberSettings(data.settings);
}

/** Resolved settings for a set of members, keyed by id. Anyone missing from
 *  the result carries the defaults. */
export async function memberSettingsFor(
  ids: readonly string[]
): Promise<Map<string, MemberSettings>> {
  const out = new Map<string, MemberSettings>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return out;

  const { data, error } = await db()
    .from("members")
    .select("id, settings")
    .in("id", unique);
  if (error) {
    // fail OPEN — see the header note
    console.error("[member-settings] read failed, treating everyone as opted in:", error.message);
    for (const id of unique) out.set(id, { ...MEMBER_SETTINGS_DEFAULTS });
    return out;
  }
  const rows = (data ?? []) as Row[];
  const byId = new Map(rows.map((r) => [r.id, r.settings]));
  for (const id of unique) out.set(id, resolveMemberSettings(byId.get(id)));
  return out;
}
