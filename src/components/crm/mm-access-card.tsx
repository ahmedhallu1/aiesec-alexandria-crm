"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MM_ACCESS_HINT, MM_ACCESS_LABEL, MM_ACCESS_MODES, type MmAccess } from "@/lib/mm-access";
import type { MmAccessBlock, MmAccessRow } from "@/server/data";
import { setMmAccess } from "@/server/actions";

/** 🔑 MM ACCESS (v37.4) — the function's VP decides, per MM, whose work they
 *  reach: their team, the whole function, or only themself. Every change is
 *  saved on pick and checked again on the server (setMmAccess). */
export function MmAccessCard({ blocks }: { blocks: MmAccessBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-primary" /> MM access
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose whose work each of your MMs can see and handle — accounts, sign-ups and calls.
          <b> Their team</b> is a Team Leader&apos;s normal access, <b>only themself</b> is a
          Coordinator&apos;s. Who reports to whom doesn&apos;t change.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {blocks.map((b) => (
          <Block key={b.fn} block={b} />
        ))}
      </CardContent>
    </Card>
  );
}

function Block({ block }: { block: MmAccessBlock }) {
  const [q, setQ] = useState("");
  const shown = block.mms.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{block.label}</h3>
        <span className="text-xs text-muted-foreground">
          {block.mms.length} MM{block.mms.length === 1 ? "" : "s"} · {block.floorSize} people on the floor
        </span>
        {block.mms.length > 8 ? (
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find an MM…"
            className="ml-auto h-8 w-44"
          />
        ) : null}
      </div>
      {block.mms.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Team Leaders or Coordinators in {block.label} yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {shown.map((m) => (
            <MmRow key={m.id} fn={block.fn} row={m} floorSize={block.floorSize} />
          ))}
        </div>
      )}
    </section>
  );
}

function MmRow({ fn, row, floorSize }: { fn: string; row: MmAccessRow; floorSize: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (v: string) =>
    start(async () => {
      const mode = v === "__default" ? null : (v as MmAccess);
      const res = await setMmAccess(fn, row.id, mode);
      if (res.ok) {
        toast.success(
          mode
            ? `${row.name}: ${MM_ACCESS_LABEL[mode].toLowerCase()}`
            : `${row.name} is back on the ${row.role === "Team Leader" ? "team" : "Coordinator"} default`
        );
        router.refresh();
      } else toast.error(res.error);
    });
  const reachCount =
    row.effective === "function" ? floorSize : row.effective === "team" ? row.teamSize : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" dir="auto">{row.name}</p>
        <p className="text-xs text-muted-foreground">
          {row.role}
          {row.role === "Team Leader" ? ` · ${row.teamSize} in their team` : ""}
          {" · reaches "}
          {reachCount === 0 ? "nobody else" : `${reachCount} ${reachCount === 1 ? "person" : "people"}`}
        </p>
        <p className="text-[11px] text-muted-foreground/80">{MM_ACCESS_HINT[row.effective]}</p>
      </div>
      {row.override ? <Badge variant="outline" className="text-[10px]">set by you</Badge> : null}
      {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      <Select value={row.override ?? "__default"} onValueChange={pick} disabled={pending}>
        <SelectTrigger size="sm" className="w-full shrink-0 text-xs sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default">
            Default — {MM_ACCESS_LABEL[row.role === "Team Leader" ? "team" : "none"].toLowerCase()}
          </SelectItem>
          {/* the LABEL only — whatever is inside an item is also what the
              closed trigger shows, and a two-line hint was cut off in it.
              The hint for the current choice is printed under the name. */}
          {MM_ACCESS_MODES.map((m) => (
            <SelectItem key={m} value={m}>{MM_ACCESS_LABEL[m]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
