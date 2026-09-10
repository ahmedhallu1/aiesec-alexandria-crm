import "server-only";
import { db } from "@/lib/supabase";
import type { AccountContact, AccountFunction } from "@/lib/types";

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
 *  THE WORLDS RULE IS THE NAME RULE. Since v33.29 the same company may be an
 *  IGV partner, a BD sponsor and a B2C venue at once, so a clash only refuses
 *  inside the same name world (ICX · BD · B2C) — exactly where a duplicate
 *  NAME is refused. A number the other world already has is the same company
 *  doing different business with us, which is allowed. */

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

const worldOf = (f: string | null | undefined): "ICX" | "BD" | "B2C" =>
  f === "B2C" ? "B2C" : f === "BD" ? "BD" : "ICX";

const kindOf = (key: string): ContactClash["kind"] =>
  key.startsWith("p:") ? "phone" : key.startsWith("e:") ? "email" : "link";

/** 'p:201012345678' → '+201012345678'; emails and links as they are. */
export function displayContactKey(key: string): string {
  return key.startsWith("p:") ? `+${key.slice(2)}` : key.slice(2);
}

/** The accounts in the SAME world that already hold one of these values.
 *  `excludeId` is the account being edited — its own values never clash, and
 *  values it already carried before this guard existed are not re-checked.
 *  Fails OPEN: a database hiccup must never stop somebody adding an account. */
export async function contactClashes(
  contacts: AccountContact[],
  opts: { fn: AccountFunction | string | null; excludeId?: string | null }
): Promise<ContactClash[]> {
  if (contacts.length === 0) return [];
  const { data, error } = await db().rpc("account_contact_clashes", {
    p_contacts: contacts,
    p_exclude: opts.excludeId ?? null,
  });
  if (error) {
    console.error("[contacts] clash check failed, allowing:", error.message);
    return [];
  }
  const world = worldOf(opts.fn);
  return ((data ?? []) as Row[])
    .filter((r) => worldOf(r.function) === world)
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
