"use server";

import { getViewer } from "@/server/data";
import { allowedAccountFunctions } from "@/lib/rbac";
import type { AccountContact } from "@/lib/types";
import { contactClashes, type ContactClash } from "@/server/contact-clashes";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** THE LIVE DUPLICATE CHECK (v36.5) — while a phone, email or link is being
 *  typed, not after Save. The first version only refused on Save, so a member
 *  filled the whole form and learned nothing until the end; the name has been
 *  checked live since v22.2, and a number that is already on another account
 *  is the same kind of bad news. Save still refuses on its own — this is the
 *  early warning, not the guard.
 *
 *  Same gate as the name check: only people who can create accounts, and the
 *  same level of detail the name check already shows (the account, its
 *  function, who holds it). */
export async function checkContactClashesLive(
  contacts: AccountContact[],
  excludeId?: string | null
): Promise<Result<ContactClash[]>> {
  const viewer = await getViewer();
  if (allowedAccountFunctions(viewer).length === 0) return { ok: true, data: [] };
  if (!Array.isArray(contacts)) return { ok: false, error: "Nothing to check." };
  const rows = contacts
    .filter(
      (c) =>
        c &&
        (c.kind === "phone" || c.kind === "email" || c.kind === "link") &&
        typeof c.value === "string" &&
        c.value.trim().length >= 5
    )
    .slice(0, 30)
    .map((c) => ({
      tag: String(c.tag ?? "").slice(0, 40),
      kind: c.kind,
      value: c.value.trim().slice(0, 400),
    }));
  if (rows.length === 0) return { ok: true, data: [] };
  return { ok: true, data: await contactClashes(rows, { excludeId: excludeId ?? null }) };
}
