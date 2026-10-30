"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Pencil, RotateCcw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/types";
import {
  PRIVILEGE_GROUPS, PRIVILEGE_REGISTRY, describePrivilege, privilegeIsDefault,
  type PrivilegeAudience, type PrivilegeBase, type PrivilegeDef, type PrivilegeRule,
} from "@/lib/privileges";
import { resetAllPrivilegeRules, resetPrivilegeRule, savePrivilegeRule } from "@/server/privilege-actions";
import { AudienceBlock, type PickPerson } from "./people-pick";

/** SETTINGS → RULES (v38.4) — the LCP and the admins decide WHAT people may
 *  do, the way Settings → Tabs decides WHICH PAGES they may open. The rule
 *  engine is src/lib/privileges.ts; this is only its editor. */

const EMPTY: PrivilegeAudience = { members: [], roles: [], functions: [] };

export function PrivilegeManager({
  rules, people,
}: {
  rules: PrivilegeRule[];
  people: PickPerson[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<PrivilegeDef | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const byKey = useMemo(() => new Map(rules.map((r) => [r.key, r])), [rules]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const changed = PRIVILEGE_REGISTRY.filter((p) => !privilegeIsDefault(byKey.get(p.key))).length;

  const resetAll = () =>
    start(async () => {
      const res = await resetAllPrivilegeRules();
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Every rule follows the code again.");
        setConfirmReset(false);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-xs text-muted-foreground">
            Settings → Tabs decides which <b>pages</b> someone can open. This decides what they may{" "}
            <b>do</b> once they are there. Every rule follows the code until you change it here, and
            each one says exactly what saying yes hands over. A rule widens one decision — it never
            widens what a person can see: a Member you let revive accounts still only reaches the
            archive everyone already reads.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={changed > 0 ? "default" : "secondary"}>
              {changed === 0
                ? "Every rule is the code's"
                : `${changed} rule${changed === 1 ? "" : "s"} changed`}
            </Badge>
            {changed > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setConfirmReset(true)}
              >
                <RotateCcw className="size-4" /> Put everything back
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {PRIVILEGE_GROUPS.map((group) => {
        const defs = PRIVILEGE_REGISTRY.filter((p) => p.group === group);
        if (defs.length === 0) return null;
        return (
          <Card key={group}>
            <CardContent className="space-y-1.5 pt-4">
              <p className="pb-1 text-sm font-bold">{group}</p>
              {defs.map((def) => {
                const rule = byKey.get(def.key);
                const custom = !privilegeIsDefault(rule);
                return (
                  <div
                    key={def.key}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-lg border p-2.5",
                      custom && "border-primary/40 bg-primary/5"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                        {def.label}
                        {custom ? (
                          <Badge variant="outline" className="text-[10px]">
                            changed
                          </Badge>
                        ) : null}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {describePrivilege(rule, names)}
                        {rule?.updatedBy ? ` · by ${rule.updatedBy}` : ""}
                        {rule?.updatedAt && custom ? ` · ${fmtDateTime(rule.updatedAt)}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setEditing(def)}
                    >
                      <Pencil className="size-3.5" /> Change
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {editing ? (
        <EditPrivilegeDialog
          def={editing}
          rule={byKey.get(editing.key)}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <Dialog open={confirmReset} onOpenChange={(o) => !o && setConfirmReset(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Put every rule back?</DialogTitle>
            <DialogDescription>
              All {changed} changed rule{changed === 1 ? "" : "s"} go back to what the code says.
              Nothing else is touched, and you can change them again straight away.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmReset(false)} disabled={pending}>
              Keep them
            </Button>
            <Button onClick={resetAll} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Put everything back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditPrivilegeDialog({
  def, rule, people, onClose, onSaved,
}: {
  def: PrivilegeDef;
  rule: PrivilegeRule | undefined;
  people: PickPerson[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [base, setBase] = useState<PrivilegeBase>(rule?.base ?? "default");
  const [allow, setAllow] = useState<PrivilegeAudience>(rule?.allow ?? EMPTY);
  const [deny, setDeny] = useState<PrivilegeAudience>(rule?.deny ?? EMPTY);
  const [note, setNote] = useState(rule?.note ?? "");

  const save = () =>
    start(async () => {
      const res = await savePrivilegeRule({ key: def.key, base, allow, deny, note });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`${def.label} saved.`);
        onSaved();
      }
    });
  const reset = () =>
    start(async () => {
      const res = await resetPrivilegeRule(def.key);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`${def.label} follows the code again.`);
        onSaved();
      }
    });

  const BASES: { v: PrivilegeBase; title: string; hint: string }[] = [
    { v: "default", title: "As the code says", hint: def.builtIn },
    { v: "everyone", title: "Everyone", hint: "Every signed-in member" },
    { v: "nobody", title: "Nobody", hint: "Only the people / groups you add below" },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{def.label}</DialogTitle>
          <DialogDescription>
            A person named below always wins over a role or function; on the same level, not
            allowed wins over allowed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <p className="flex gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <b className="text-foreground">What saying yes hands them.</b> {def.what}
            </span>
          </p>
          {def.caution ? (
            <p className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{def.caution}</span>
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <Label>Who may, to start with</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {BASES.map((b) => (
                <button
                  key={b.v}
                  type="button"
                  onClick={() => setBase(b.v)}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors",
                    base === b.v ? "border-primary bg-primary/10" : "hover:bg-muted"
                  )}
                >
                  <p className="text-sm font-semibold">{b.title}</p>
                  <p className="text-xs text-muted-foreground">{b.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <AudienceBlock
            title="Also allow"
            hint="They get it even if the code wouldn't give it to them."
            value={allow}
            onChange={setAllow}
            people={people}
            tone="primary"
          />
          <AudienceBlock
            title="Never allow"
            hint="They never get it, even if the code would."
            value={deny}
            onChange={setDeny}
            people={people}
            tone="destructive"
          />

          <div className="grid gap-1.5">
            <Label htmlFor="priv-note">Note for the other admins (optional)</Label>
            <Textarea
              id="priv-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Why this was changed — the next LCP reads this."
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={reset} disabled={pending || !rule}>
            <RotateCcw className="size-4" /> Back to the code&apos;s rule
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
