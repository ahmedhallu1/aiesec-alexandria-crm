/** An ILIKE pattern that matches `value` EXACTLY, case-insensitively (v37.7).
 *
 *  `%` and `_` are LIKE wildcards, and `_` is legal in an email address, so an
 *  identity lookup with the raw value let "mona_ali@x.com" resolve to the
 *  member "mona.ali@x.com" — Google sign-in included — and let the public
 *  login page answer patterns like "%hallul%@%". PostgREST also reads `*` as
 *  `%` and offers no way to escape it, so a value containing `*` cannot be
 *  matched exactly at all: null means "treat it as no match". */
export function exactIlike(value: string): string | null {
  if (value.includes("*")) return null;
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
