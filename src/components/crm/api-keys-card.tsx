"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Plus, ShieldOff } from "lucide-react";
import { createApiKey, revokeApiKey } from "@/server/actions";
import type { ApiKeyRow } from "@/server/api-keys";
import { API_FIELD_LABEL, API_FIELDS, API_FUNCTIONS, type ApiFields } from "@/lib/api-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";

/** ISSUE AND REVOKE KEYS FOR THE READ-ONLY ACCOUNTS ENDPOINT.
 *
 *  The key is shown exactly ONCE — only its hash is stored, which is the whole
 *  point — so the panel that reveals it has to be impossible to miss and has
 *  to say plainly that closing it loses the key. */
export function ApiKeysCard({ keys, origin }: { keys: ApiKeyRow[]; origin: string }) {
  const [label, setLabel] = useState("");
  // the SCOPE is the key's, not the request's — issued once, here
  const FNS = API_FUNCTIONS;
  const [fns, setFns] = useState<string[]>(["IGV", "IGT", "B2B", "BD"]);
  const [fields, setFields] = useState<ApiFields>("names");
  const [withArchived, setWithArchived] = useState(true);
  const [expiresOn, setExpiresOn] = useState("");
  const [rate, setRate] = useState("120");
  const [fresh, setFresh] = useState<{ label: string; key: string } | null>(null);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const res = await createApiKey({
        label,
        functions: fns,
        fields,
        includeArchived: withArchived,
        expiresOn: expiresOn || null,
        ratePerHour: Number(rate) || 120,
      });
      if (!res.ok || !res.data) {
        toast.error(res.ok ? "The key came back empty — try again." : res.error);
        return;
      }
      setFresh({ label: label.trim(), key: res.data.key });
      setLabel("");
    });

  const revoke = (k: ApiKeyRow) =>
    start(async () => {
      const res = await revokeApiKey(k.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`"${k.label}" revoked — it stops working immediately.`);
    });

  const live = keys.filter((k) => !k.revoked_at);
  const dead = keys.filter((k) => k.revoked_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" /> API keys
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          For <code className="rounded bg-muted px-1">GET /api/v1/accounts</code> — every
          account name the ICX and BD floors already hold (active, archived and
          blacklisted), so an automatic market-research tool knows what <b>not</b> to add.
          Names only: no phones, no emails, no owners, no numbers.
        </p>

        {fresh ? (
          <div className="rounded-lg border-2 border-primary bg-accent p-3">
            <p className="text-sm font-bold text-accent-foreground">
              Here is the key for “{fresh.label}”. Copy it now.
            </p>
            <p className="mt-1 text-xs text-accent-foreground/80">
              Sodio stores only a hash of it, so this is the one and only time it can be
              shown. Lose it and you issue a new one — there is no recovery.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
                {fresh.key}
              </code>
              <Button
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(fresh.key);
                  toast.success("Key copied.");
                }}
              >
                <Copy className="size-3.5" /> Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
                Done
              </Button>
            </div>
            <p className="mt-2 text-xs text-accent-foreground/80">
              The whole API in one file — hand it straight to an AI to write the integration:
            </p>
            <code className="mt-1 block overflow-x-auto rounded bg-background px-2 py-1 text-[11px]">
              curl -H &quot;Authorization: Bearer &lt;key&gt;&quot; {origin}/api/v1/docs -o
              sodio-accounts-api.md
            </code>
          </div>
        ) : null}

        <div className="grid gap-3 rounded-lg border p-3">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is it for? e.g. “Ahmed's MR bot”"
            className="min-w-0"
          />

          <div className="grid gap-1.5">
            <Label className="text-xs">Which accounts it can read</Label>
            <div className="flex flex-wrap gap-1.5">
              {FNS.map((f) => {
                const on = fns.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() =>
                      setFns((prev) => (on ? prev.filter((x) => x !== f) : [...prev, f]))
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      on
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">What it can see of each one</Label>
            <Select value={fields} onValueChange={(v) => setFields(v as ApiFields)}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {API_FIELD_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fields === "contacts" ? (
              <p className="text-xs text-warning">
                ⚠️ This hands out partner phone numbers and emails. Only for a tool you control.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
            <Label className="text-xs">
              Include archived &amp; blacklisted names
              <span className="block font-normal text-muted-foreground">
                Leave on — a tool that can&apos;t see them keeps re-proposing burned companies.
              </span>
            </Label>
            <Switch checked={withArchived} onCheckedChange={setWithArchived} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Expires on (optional)</Label>
              <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Requests an hour</Label>
              <Input
                type="number"
                min={10}
                max={2000}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={create} disabled={pending || label.trim().length < 2 || fns.length === 0}>
            <Plus className="size-4" /> Issue key
          </Button>
        </div>

        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">No live keys.</p>
        ) : (
          <div className="space-y-2">
            {live.map((k) => (
              <div
                key={k.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <b className="break-words">{k.label}</b>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {k.prefix}…
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {(k.functions ?? []).join(" · ") || "no functions"} · {k.fields}
                    {k.include_archived ? " · with archive" : ""} · {k.rate_per_hour}/h
                    {k.expires_at ? ` · expires ${k.expires_at.slice(0, 10)}` : ""}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {k.request_count.toLocaleString()} request
                    {k.request_count === 1 ? "" : "s"}
                    {k.last_used_at ? ` · last used ${fmtDateTime(k.last_used_at)}` : " · never used"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => revoke(k)}
                >
                  <ShieldOff className="size-3.5" /> Revoke
                </Button>
              </div>
            ))}
          </div>
        )}

        {dead.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Revoked ({dead.length})
            </summary>
            <div className="mt-2 space-y-1">
              {dead.map((k) => (
                <p key={k.id} className="text-xs text-muted-foreground">
                  <Badge variant="outline" className="mr-2">revoked</Badge>
                  {k.label} · {k.prefix}… · {k.request_count.toLocaleString()} requests
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
