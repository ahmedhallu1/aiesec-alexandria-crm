/** DOES THIS ADDRESS PLAUSIBLY EXIST? (v33.29, hardened v33.32)
 *
 *  A live case: an IR typed her own email REVERSED (first.last vs last.first),
 *  the domain was real, Gmail accepted the send and bounced it later — and the
 *  bounce died unread in the IM inbox while her confirmation, manage link and
 *  calendar invite all went nowhere.
 *
 *  No pre-send check can prove a MAILBOX exists (servers accept-then-bounce on
 *  purpose, and outbound port 25 is closed on the host we run on, so an SMTP
 *  RCPT probe isn't available either). What CAN be decided before accepting a
 *  booking — and is, in this order, cheapest first:
 *   · the SHAPE is impossible (empty parts, a dot at either end, "..", too long)
 *   · the domain is a classic typo (gamil.com) or ONE EDIT from a big provider
 *   · the domain is disposable — an address we could never reach them at again
 *   · the local part BREAKS THE PROVIDER'S OWN RULES. Gmail publishes its:
 *     letters/digits/dots only, 6–30 characters. "a.b@gmail.com" cannot exist,
 *     so refusing it is a fact, not a guess.
 *   · the DOMAIN resolves and receives mail (MX, or A as RFC 5321 fallback)
 *  Everything else is handled after the fact by the bounce watcher.
 *
 *  FAIL OPEN: a DNS hiccup must never block a real booking. Every rule above
 *  either proves impossibility or is a lookup whose failure is ignored.
 */

const TYPO_DOMAINS: Record<string, string> = {
  "gamil.com": "gmail.com", "gmial.com": "gmail.com", "gmal.com": "gmail.com",
  "gmali.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmail.cm": "gmail.com",
  "hotnail.com": "hotmail.com", "hotmial.com": "hotmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com",
  "outlok.com": "outlook.com", "iclould.com": "icloud.com",
  // AIESEC's own, mistyped — most IRs write from one of these
  "aiesec.com": "aiesec.net", "aiesec.ne": "aiesec.net", "aisec.net": "aiesec.net",
  "aiesecmember.com": "aiesecmember.in",
};

/** The domains an edit-distance-1 typo is measured against. Deliberately
 *  short: every entry here refuses addresses, so a wrong one costs bookings. */
const BIG_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "icloud.com", "live.com", "aol.com", "proton.me", "protonmail.com",
  "aiesec.net", "aiesec.org",
];

/** Addresses at these are unreachable a week later — an IR booking is a
 *  relationship, and a burner address is the same as no address. */
const DISPOSABLE = new Set([
  "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "throwawaymail.com", "sharklasers.com",
  "trashmail.com", "getnada.com", "maildrop.cc", "dispostable.com",
  "fakeinbox.com", "mailnesia.com", "spam4.me", "grr.la", "emailondeck.com",
]);

/** Levenshtein, capped at 2 — we only ever ask "is this one edit away?" */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Gmail's own published rules. A local part that breaks them names a mailbox
 *  that CANNOT be created, so this is the one place we can honestly say
 *  "that address is wrong" before sending anything. */
function gmailLocalPartIssue(local: string): string | null {
  // a +tag is Gmail's own aliasing — the account is what precedes it
  const account = local.split("+")[0];
  if (!/^[a-z0-9.]+$/i.test(account))
    return "A Gmail address can only use letters, numbers and dots — check yours.";
  const bare = account.replaceAll(".", "");
  if (bare.length < 6)
    return "A Gmail username is at least 6 characters — check the address.";
  if (bare.length > 30)
    return "That Gmail username is longer than Gmail allows — check the address.";
  return null;
}

const okCache = new Map<string, { ok: boolean; at: number }>();
const TTL = 6 * 60 * 60 * 1000;

/** null = fine (or unknown) · a string = the reason to show the person. */
export async function emailDomainIssue(address: string): Promise<string | null> {
  const at = address.lastIndexOf("@");
  const local = at > 0 ? address.slice(0, at) : "";
  const domain = at > 0 ? address.slice(at + 1).toLowerCase() : "";
  if (!domain || !local) return "That email is missing its domain.";

  // ---- shape: things that are simply not addresses
  if (local.length > 64) return "That email's first half is too long to be real.";
  if (local.startsWith(".") || local.endsWith(".") || local.includes(".."))
    return "That email has a stray dot — check it letter by letter.";
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes(".."))
    return "That email's domain has a stray dot — check it.";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
    return `"${domain}" isn't a valid domain — check the part after the @.`;

  // ---- known typos: a curated list, so refusing outright is safe
  const known = TYPO_DOMAINS[domain];
  if (known) return `"${domain}" looks like a typo of ${known} — double-check it.`;
  // ONE EDIT from a big provider is a SUSPICION, not a fact — "mail.com" is a
  // real provider one edit from gmail.com, and refusing it would cost real
  // bookings. So the near-miss only sharpens the message when the domain also
  // turns out not to receive mail at all (below).
  const nearMiss = BIG_DOMAINS.includes(domain)
    ? null
    : BIG_DOMAINS.find((d) => editDistance(domain, d) === 1) ?? null;

  if (DISPOSABLE.has(domain))
    return `"${domain}" is a temporary-mail service — give us an address we can still reach you at.`;

  // ---- the provider's own rules for the part before the @
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const issue = gmailLocalPartIssue(local);
    if (issue) return issue;
  }

  const dead = nearMiss
    ? `"${domain}" doesn't receive email — did you mean ${nearMiss}?`
    : `"${domain}" doesn't seem to receive email — check the address.`;
  const hit = okCache.get(domain);
  if (hit && Date.now() - hit.at < TTL) return hit.ok ? null : dead;

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
    return ok ? null : dead;
  } catch {
    return null; // DNS unreachable — never block a real booking on our hiccup
  }
}
