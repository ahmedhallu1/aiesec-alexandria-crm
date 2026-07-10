"use client";

import { Globe, Mail, Phone, Plus, Trash2 } from "lucide-react";
import {
  CONTACT_TAGS, EMAIL_RE, LINK_TAGS, normalizePhone, URL_RE,
  type AccountContact,
} from "@/lib/types";
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
    tags: CONTACT_TAGS,
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
 *  free-text "Other". Used on the account page AND the add-account dialog. */
export function ContactsEditor({
  rows, onChange, disabled,
}: {
  rows: AccountContact[];
  onChange: (rows: AccountContact[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<AccountContact>) =>
    onChange(rows.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const add = (kind: AccountContact["kind"]) =>
    onChange([
      ...rows,
      { tag: kind === "link" ? "Website" : "Contact", kind, value: "" },
    ]);

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
        const known = (meta.tags as readonly string[]).filter((t) => t !== "Other");
        const isCustomTag = !known.includes(c.tag);
        return (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-2.5 shrink-0 text-muted-foreground">{meta.icon}</span>
            <div className="w-[6.8rem] shrink-0 space-y-1">
              <Select
                value={isCustomTag ? "Other" : c.tag}
                disabled={disabled}
                onValueChange={(v) =>
                  update(i, { tag: v === "Other" ? "" : v })
                }
              >
                <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Tag" /></SelectTrigger>
                <SelectContent>
                  {meta.tags.map((t) => (
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
                  onChange={(e) => update(i, { tag: e.target.value })}
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
                onChange={(e) => update(i, { value: e.target.value })}
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
