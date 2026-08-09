/** DOES THIS ADDRESS PLAUSIBLY EXIST? (v33.29)
 *
 *  A live case: an IR typed her own email REVERSED (first.last vs last.first),
 *  the domain was real, Gmail accepted the send and bounced it later — and the
 *  bounce died unread in the IM inbox while her confirmation, manage link and
 *  calendar invite all went nowhere.
 *
 *  No pre-send check can prove a MAILBOX exists (servers accept-then-bounce on
 *  purpose). What CAN be checked before accepting a booking:
 *   · the DOMAIN resolves and receives mail (MX, or A as RFC fallback)
 *   · it is not one of the classic typo domains (gamil.com and friends)
 *  Everything else is handled after the fact by the bounce watcher.
 *
 *  FAIL OPEN: a DNS hiccup must never block a real booking.
 */

const TYPO_DOMAINS: Record<string, string> = {
  "gamil.com": "gmail.com", "gmial.com": "gmail.com", "gmal.com": "gmail.com",
  "gmali.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com",
  "hotnail.com": "hotmail.com", "hotmial.com": "hotmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com",
  "outlok.com": "outlook.com", "iclould.com": "icloud.com",
};

const okCache = new Map<string, { ok: boolean; at: number }>();
const TTL = 6 * 60 * 60 * 1000;

/** null = fine (or unknown) · a string = the reason to show the person. */
export async function emailDomainIssue(address: string): Promise<string | null> {
  const domain = address.split("@")[1]?.toLowerCase();
  if (!domain) return "That email is missing its domain.";
  const fix = TYPO_DOMAINS[domain];
  if (fix) return `"${domain}" looks like a typo of ${fix} — double-check it.`;

  const hit = okCache.get(domain);
  if (hit && Date.now() - hit.at < TTL)
    return hit.ok ? null : `"${domain}" doesn't seem to receive email — check the address.`;

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const q = async (type: string) => {
      const r = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
        { signal: ctl.signal, headers: { accept: "application/dns-json" } }
      );
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { Status: number; Answer?: unknown[] };
    };
    const mx = await q("MX");
    let ok = mx.Status === 0 && (mx.Answer?.length ?? 0) > 0;
    if (!ok) {
      // RFC 5321: no MX → fall back to an A/AAAA record
      const a = await q("A");
      ok = a.Status === 0 && (a.Answer?.length ?? 0) > 0;
    }
    clearTimeout(timer);
    okCache.set(domain, { ok, at: Date.now() });
    return ok ? null : `"${domain}" doesn't seem to receive email — check the address.`;
  } catch {
    return null; // DNS unreachable — never block a real booking on our hiccup
  }
}
