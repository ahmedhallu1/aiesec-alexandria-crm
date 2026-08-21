"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Plus, ShieldOff } from "lucide-react";
import { createApiKey, revokeApiKey } from "@/server/actions";
import type { ApiKeyRow } from "@/server/api-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/types";

/** ISSUE AND REVOKE KEYS FOR THE READ-ONLY ACCOUNTS ENDPOINT.
 *
 *  The key is shown exactly ONCE — only its hash is stored, which is the whole
 *  point — so the panel that reveals it has to be impossible to miss and has
 *  to say plainly that closing it loses the key. */
export function ApiKeysCard({ keys }: { keys: ApiKeyRow[] }) {
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ label: string; key: string } | null>(null);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const res = await createApiKey(label);
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
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is it for? e.g. “Ahmed's MR bot”"
            className="min-w-0 flex-1"
          />
          <Button onClick={create} disabled={pending || label.trim().length < 2}>
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
