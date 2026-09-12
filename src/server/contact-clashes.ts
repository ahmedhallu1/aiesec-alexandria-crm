import "server-only";
import { db } from "@/lib/supabase";
import type { AccountContact } from "@/lib/types";

/** THE SAME COMPANY UNDER ANOTHER NAME (v36.4).
 *
 *  Asked for in as many words: "adding a phone number that is on another
 *  account marks this account as a duplicate — refuse, and give the details.
 *  Same for links and emails. Sometimes someone adds the same account under a
 *  different name, like 'abc kindergarten' and 'abc pre school'."
 *
 *  The comparison itself lives in SQL (`contact_key`, migration 0078) so the
 *  stored side and the typed side can never be normalised two different ways.
 *  This file only asks, and words the answer.
 *
 *  ANY ACCOUNT, ANY FUNCTION (v36.5). v36.4 refused only inside the same name
 *  world (ICX · BD · B2C), copying the name rule — and on its first day two
 *  duplicates walked straight through it: "boba spot" (BD) with the phone of
 *  "boba spot cafe" (IGV), and "Tim's coffee" (BD) with timscoffee.eg's (B2B).
 *  The floor asked for a refusal whenever the value is on ANOTHER account, and
 *  that is the rule now: the member is shown the account that has it and
 *  works that one. */

export interface ContactClash {
  key: string;
  /** the value as the member would recognise it */
  value: string;
  kind: "phone" | "email" | "link";
  accountId: string;
  name: string;
  function: string | null;
  responsibleName: string | null;
  archived: boolean;
  oopReason: string | null;
}

interface Row {
  key: string;
  account_id: string;
  name: string;
  function: string | null;
  responsible_name: string | null;
  out_of_process: boolean;
  oop_reason: string | null;
}

const kindOf = (key: string): ContactClash["kind"] =>
  key.startsWith("p:") ? "phone" : key.startsWith("e:") ? "email" : "link";

/** 'p:201012345678' → '+201012345678'; emails and links as they are. */
export function displayContactKey(key: string): string {
  return key.startsWith("p:") ? `+${key.slice(2)}` : key.slice(2);
}

/** Every OTHER account that already holds one of these values, in any
 *  function. `excludeId` is the account being edited — its own values never
 *  clash, and values it already carried before this guard existed are not
 *  re-checked. Fails OPEN: a database hiccup must never stop somebody adding
 *  an account (and says so in the log). */
export async function contactClashes(
  contacts: AccountContact[],
  opts: { excludeId?: string | null } = {}
): Promise<ContactClash[]> {
  if (contacts.length === 0) return [];
  const exclude =
    opts.excludeId && /^[0-9a-f-]{36}$/i.test(opts.excludeId) ? opts.excludeId : null;
  const { data, error } = await db().rpc("account_contact_clashes", {
    p_contacts: contacts,
    p_exclude: exclude,
  });
  if (error) {
    console.error("[contacts] clash check failed, allowing:", error.message);
    return [];
  }
  return ((data ?? []) as Row[])
    .map((r) => ({
      key: r.key,
      value: displayContactKey(r.key),
      kind: kindOf(r.key),
      accountId: r.account_id,
      name: r.name,
      function: r.function,
      responsibleName: r.responsible_name,
      archived: r.out_of_process,
      oopReason: r.oop_reason,
    }));
}

/** The refusal: one sentence, then the details of the account that has it. */
export function clashRefusal(c: ContactClash): {
  message: string;
  info: Record<string, string | null>;
} {
  const what = c.kind === "phone" ? "phone number" : c.kind;
  return {
    message: c.archived
      ? `This ${what} (${c.value}) belongs to "${c.name}", which is archived — it's the same company. Revive that account instead of adding it again.`
      : `This ${what} (${c.value}) is already on "${c.name}" — the same company under another name? Work that account instead of adding a second one.`,
    info: {
      account: c.name,
      function: c.function ?? "Unassigned pool",
      responsible: c.responsibleName ?? "Unassigned",
      status: c.archived ? `Archived${c.oopReason ? ` — ${c.oopReason}` : ""}` : "Active",
      [what]: c.value,
    },
  };
}
