"use client";

import { useRef } from "react";
import { Globe, Mail, Phone, Plus, Trash2 } from "lucide-react";
import {
  CONTACT_TAGS, DEFAULT_CONTACT_TAG, EMAIL_RE, EMAIL_TAGS, guessContactTag,
  isMapLink, phoneTagsFor,
  LINK_TAGS, normalizePhone, URL_RE,
  type AccountContact,
} from "@/lib/types";
import { GoogleMapsIcon } from "./icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const kindMeta = {
  phone: {
    icon: <Phone className="size-3.5" />,
    tags: CONTACT_TAGS,
    placeholder: "01XXXXXXXXX or 03XXXXXXX",
    inputMode: "tel" as const,
  },
  email: {
    icon: <Mail className="size-3.5" />,
    tags: EMAIL_TAGS,
    placeholder: "name@company.com",
    inputMode: "email" as const,
  },
  link: {
    icon: <Globe className="size-3.5" />,
    tags: LINK_TAGS,
    placeholder: "https://…",
    inputMode: "url" as const,
  },
};

export function contactIssue(c: AccountContact): string | null {
  if (!c.value.trim()) return null; // empty rows are dropped on save
  if (c.kind === "phone") {
    const check = normalizePhone(c.value);
    return check.ok ? null : check.error ?? "Invalid number.";
  }
  if (c.kind === "email")
    return EMAIL_RE.test(c.value.trim()) ? null : "Valid email only.";
  return URL_RE.test(c.value.trim()) ? null : "Must be a link (https://…).";
}

export function contactsValid(rows: AccountContact[]): boolean {
  return rows.every((c) => contactIssue(c) === null);
}

/** Tagged phones / emails / links editor — the tag is a curated list with a
 *  free-text "Other". Used on the account page AND the add-account dialog.
 *  Links and emails TAG THEMSELVES as they're typed or pasted (an Instagram
 *  page → Instagram, ceo@… → CEO) — until the member picks a tag by hand, and
 *  from then on their choice is never overwritten. */
export function ContactsEditor({
  rows, onChange, disabled,
}: {
  rows: AccountContact[];
  onChange: (rows: AccountContact[]) => void;
  disabled?: boolean;
}) {
  // rows whose tag the MEMBER set — auto-tagging keeps its hands off these.
  // Rows have no id, so the set holds indices and follows removals.
  const manualTags = useRef<Set<number>>(new Set());

  const update = (i: number, patch: Partial<AccountContact>) =>
    onChange(rows.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => {
    const next = new Set<number>();
    for (const j of manualTags.current) {
      if (j < i) next.add(j);
      else if (j > i) next.add(j - 1);
    }
    manualTags.current = next;
    onChange(rows.filter((_, j) => j !== i));
  };
  const add = (kind: AccountContact["kind"]) =>
    onChange([...rows, { tag: DEFAULT_CONTACT_TAG[kind], kind, value: "" }]);

  /** Auto-tagging only writes into an UNTOUCHED tag: the kind's default, or
   *  one the system itself put there (it still equals the guess for the value
   *  that was in the field a keystroke ago). A tag a human chose — now or in
   *  an earlier session — is left exactly as it is. */
  const setValue = (i: number, value: string) => {
    const row = rows[i];
    const patch: Partial<AccountContact> = { value };
    const untouched =
      !manualTags.current.has(i) &&
      (row.tag === DEFAULT_CONTACT_TAG[row.kind] ||
        !row.value.trim() || // emptied field: the old auto tag means nothing
        row.tag === guessContactTag(row.kind, row.value));
    if (untouched) {
      const guess = guessContactTag(row.kind, value);
      if (guess && guess !== row.tag) patch.tag = guess;
    }
    update(i, patch);
  };
  const setTagByHand = (i: number, tag: string) => {
    manualTags.current.add(i);
    update(i, { tag });
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="py-1 text-center text-sm text-muted-foreground">
          No phones, emails or links yet.
        </p>
      ) : null}
      {rows.map((c, i) => {
        const meta = kindMeta[c.kind];
        const issue = contactIssue(c);
        // a phone's own shape decides its tags: no WhatsApp on a landline or
        // a hotline, because that button would silently do nothing (v33)
        const tagChoices =
          c.kind === "phone" ? phoneTagsFor(c.value) : (meta.tags as readonly string[]);
        const known = tagChoices.filter((t) => t !== "Other");
        const isCustomTag = !known.includes(c.tag);
        return (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-2.5 shrink-0 text-muted-foreground">
              {c.kind === "link" && (c.tag === "Location" || isMapLink(c.value)) ? (
                <GoogleMapsIcon className="size-3.5" />
              ) : (
                meta.icon
              )}
            </span>
            <div className="w-[6.8rem] shrink-0 space-y-1">
              <Select
                value={isCustomTag ? "Other" : c.tag}
                disabled={disabled}
                onValueChange={(v) => setTagByHand(i, v === "Other" ? "" : v)}
              >
                <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Tag" /></SelectTrigger>
                <SelectContent>
                  {tagChoices.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isCustomTag ? (
                <Input
                  className="h-8"
                  value={c.tag}
                  disabled={disabled}
                  placeholder="Custom tag"
                  onChange={(e) => setTagByHand(i, e.target.value)}
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <Input
                className={cn("h-8", issue && "border-destructive")}
                value={c.value}
                disabled={disabled}
                inputMode={meta.inputMode}
                placeholder={meta.placeholder}
                onChange={(e) => setValue(i, e.target.value)}
                onBlur={() => {
                  // pasted numbers auto-clean to the canonical format
                  if (c.kind !== "phone" || !c.value.trim()) return;
                  const check = normalizePhone(c.value);
                  if (check.ok && check.value !== c.value) update(i, { value: check.value });
                }}
              />
              {issue ? <p className="mt-0.5 text-xs text-destructive">{issue}</p> : null}
            </div>
            {!disabled ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                title="Remove"
                onClick={() => remove(i)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
          </div>
        );
      })}
      {!disabled ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => add("phone")}>
            <Plus className="size-3.5" /> Phone
          </Button>
          <Button size="sm" variant="outline" onClick={() => add("email")}>
            <Plus className="size-3.5" /> Email
          </Button>
          <Button size="sm" variant="outline" onClick={() => add("link")}>
            <Plus className="size-3.5" /> Link
          </Button>
        </div>
      ) : null}
    </div>
  );
}
