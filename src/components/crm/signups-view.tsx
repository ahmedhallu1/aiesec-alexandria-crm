"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Archive, Hand, Loader2, Phone, RefreshCw, RotateCcw, Search, UserRound, X,
} from "lucide-react";
import {
  addSignupComment, claimSignup, openSignupDetail, reassignSignup,
  reviveSignup, runSignupsImport, setSignupOop, updateSignupContact,
  updateSignupVpFields,
} from "@/server/actions";
import type { SignupDetail } from "@/server/data";
import { COUNTRIES } from "@/lib/countries";
import { fmtDateTime, SIGNUP_STATUSES, type OgxFunction, type SignupRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Hint } from "./hint";
import { WhatsAppIcon } from "./icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const waDigits = (phone: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.startsWith("20") ? d : d.startsWith("0") ? `2${d}` : `20${d}`;
};

const VIEW_LABELS: Record<string, string> = {
  unassigned: "🆕 Unassigned",
  mine: "My sign-ups",
  team: "My team",
  all: "All",
  archived: "🗄️ Archived",
};

interface ViewerInfo {
  id: string;
  name: string;
  isLeader: boolean;
  isTl: boolean;
  canVp: boolean;
}

export function SignupsView({
  rows, total, page, pageSize, activeView, views, fns, activeFn, targets, viewer, filters,
}: {
  rows: SignupRow[];
  total: number;
  page: number;
  pageSize: number;
  activeView: string;
  views: string[];
  fns: OgxFunction[];
  activeFn: OgxFunction;
  targets: { id: string; label: string }[];
  viewer: ViewerInfo;
  filters: {
    q: string; batch: string; program: string; status: string;
    interested: string; contacted: string; sort: string; dir: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(filters.q);
  const [detail, setDetail] = useState<SignupDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      params.delete("page");
      startNav(() => router.replace(`/signups?${params.toString()}`));
    },
    [router, searchParams]
  );

  const goPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p + 1));
    startNav(() => router.replace(`/signups?${params.toString()}`));
  };

  const sortBy = (field: string, defaultDir: "asc" | "desc" = "desc") => {
    if (filters.sort === field)
      setParams({ dir: filters.dir === "asc" ? "desc" : "asc" });
    else setParams({ sort: field, dir: defaultDir });
  };

  const SortHead = ({
    field, defaultDir = "desc", children, className,
  }: {
    field: string;
    defaultDir?: "asc" | "desc";
    children: React.ReactNode;
    className?: string;
  }) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => sortBy(field, defaultDir)}
        className={cn(
          "group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95",
          filters.sort === field && "font-bold text-primary"
        )}
        title="Sort by this column"
      >
        {children}
        {filters.sort === field ? (
          <span>{filters.dir === "asc" ? "↑" : "↓"}</span>
        ) : (
          <span
            aria-hidden
            className="-translate-y-0.5 opacity-0 transition-all duration-150 group-hover/sort:translate-y-0 group-hover/sort:opacity-60"
          >
            ↕
          </span>
        )}
      </button>
    </TableHead>
  );

  const openDetail = (id: string) => {
    setDetailLoading(id);
    start(async () => {
      const res = await openSignupDetail(id);
      setDetailLoading(null);
      if (res.ok) setDetail(res.data!);
      else toast.error(res.error);
    });
  };

  const claim = (row: SignupRow) =>
    start(async () => {
      const res = await claimSignup(row.id);
      if (res.ok) {
        toast.success(`"${row.name}" is yours now — go get them! 🙌`);
        router.refresh();
      } else toast.error(res.error);
    });

  const syncNow = () =>
    start(async () => {
      const res = await runSignupsImport();
      if (res.ok) {
        toast.success(`Synced — ${res.data?.imported ?? 0} rows checked, ${res.data?.created ?? 0} new`);
        router.refresh();
      } else toast.error(res.error);
    });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const yn = (v: string | null) =>
    v ? (
      /^y/i.test(v) ? (
        <span className="font-medium text-emerald-600 dark:text-emerald-400">Yes</span>
      ) : /^n/i.test(v) ? (
        <span className="text-muted-foreground">No</span>
      ) : (
        v
      )
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  return (
    <div className={cn("mx-auto max-w-6xl space-y-4", navPending && "nav-pending")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sign-ups</h1>
          <p className="text-sm text-muted-foreground">
            Two-way synced with the {activeFn} tracker sheet — claim from the
            unassigned pool, contact, and move them down the funnel.
          </p>
        </div>
        {viewer.isLeader ? (
          <Button variant="outline" onClick={syncNow} disabled={pending}>
            <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> Sync now
          </Button>
        ) : null}
      </div>

      {/* function + view chips */}
      <div className="flex flex-wrap items-center gap-2">
        {fns.length > 1 ? (
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {fns.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setParams({ fn: f, program: null })}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-semibold transition-colors",
                  activeFn === f ? "bg-background shadow" : "text-muted-foreground"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        ) : null}
        {views.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setParams({ view: v })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              activeView === v
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/50"
            )}
          >
            {VIEW_LABELS[v] ?? v}
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setParams({ q }); }}
            onBlur={() => { if (q !== filters.q) setParams({ q }); }}
            placeholder="Name, EP ID, phone…"
            className="h-9 w-52 pl-8"
          />
        </div>
        <Select
          value={filters.batch || "all"}
          onValueChange={(v) => setParams({ batch: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">New + Old</SelectItem>
            <SelectItem value="new">New SUs</SelectItem>
            <SelectItem value="old">Old SUs</SelectItem>
          </SelectContent>
        </Select>
        {activeFn === "OGT" ? (
          <Select
            value={filters.program || "all"}
            onValueChange={(v) => setParams({ program: v === "all" ? null : v })}
          >
            <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">GTa + GTe</SelectItem>
              <SelectItem value="GTa">GTa</SelectItem>
              <SelectItem value="GTe">GTe</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        <Select
          value={filters.contacted || "all"}
          onValueChange={(v) => setParams({ contacted: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Contacted: any</SelectItem>
            <SelectItem value="Yes">Contacted ✓</SelectItem>
            <SelectItem value="No">Not contacted</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.interested || "all"}
          onValueChange={(v) => setParams({ interested: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Interested: any</SelectItem>
            <SelectItem value="Yes">Interested ✓</SelectItem>
            <SelectItem value="No">Not interested</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.status || "all"}
          onValueChange={(v) => setParams({ status: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: any</SelectItem>
            {SIGNUP_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">
          {total} sign-up{total === 1 ? "" : "s"}
        </span>
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nothing here — try another view or filter.
            </CardContent>
          </Card>
        ) : (
          rows.map((r) => (
            <Card key={r.id} onClick={() => openDetail(r.id)}>
              <CardContent className="space-y-1.5 p-3.5">
                <p className="flex items-center justify-between gap-2 font-semibold">
                  <span className="min-w-0 flex-1 truncate" dir="auto">{r.name}</span>
                  {detailLoading === r.id ? <Loader2 className="size-4 animate-spin" /> : null}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="outline" className="text-[10px]">{r.program ?? r.fn}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.batch === "new" ? "New" : "Old"}</Badge>
                  {r.status ? <Badge className="text-[10px]">{r.status}</Badge> : null}
                  <span className="text-muted-foreground">
                    {r.assigned_to || r.assigned_name ? `👤 ${r.assigned_name ?? "assigned"}` : "🆕 unassigned"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.signed_up_at ?? ""} · EP {r.ep_id}
                </p>
                {r.phone ? (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <a href={`https://wa.me/${waDigits(r.phone)}`} target="_blank" rel="noreferrer">
                        <WhatsAppIcon className="size-4" /> WhatsApp
                      </a>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <a href={`tel:${r.phone}`}><Phone className="size-4" /> Call</a>
                    </Button>
                  </div>
                ) : null}
                {!r.assigned_to && !r.assigned_name && !r.out_of_process ? (
                  <Button
                    size="sm" className="w-full"
                    disabled={pending}
                    onClick={(e) => { e.stopPropagation(); claim(r); }}
                  >
                    <Hand className="size-4" /> Claim it
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* desktop table */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block rise-in rise-in-2">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead field="signed_up_at">Signed up</SortHead>
                <SortHead field="name" defaultDir="asc">Sign-up</SortHead>
                <SortHead field="program" defaultDir="asc">Program</SortHead>
                <TableHead>Contact</TableHead>
                <TableHead>Assigned</TableHead>
                <SortHead field="contact_status" defaultDir="asc">Contacted</SortHead>
                <SortHead field="interested" defaultDir="asc">Interested</SortHead>
                <SortHead field="status" defaultDir="asc">Status</SortHead>
                <SortHead field="country" defaultDir="asc">Country</SortHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                    Nothing here — try another view or filter.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r.id)}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.signed_up_at ?? "—"}
                      <span className="block text-[10px] opacity-70">
                        {r.batch === "new" ? "New" : "Old"} SUs
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium" dir="auto">{r.name}</span>
                      <p className="text-xs text-muted-foreground">EP {r.ep_id}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.program ?? r.fn}</Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {r.phone ? (
                        <span className="flex items-center gap-1">
                          <Hint label={`WhatsApp ${r.phone}`}>
                            <Button asChild variant="outline" size="icon" className="size-7">
                              <a
                                href={`https://wa.me/${waDigits(r.phone)}`}
                                target="_blank" rel="noreferrer"
                              >
                                <WhatsAppIcon className="size-3.5" />
                              </a>
                            </Button>
                          </Hint>
                          <Hint label={`Call ${r.phone}`}>
                            <Button asChild variant="outline" size="icon" className="size-7">
                              <a href={`tel:${r.phone}`}><Phone className="size-3.5" /></a>
                            </Button>
                          </Hint>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">no phone</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.assigned_to || r.assigned_name ? (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <UserRound className="size-3.5" /> {r.assigned_name ?? "assigned"}
                        </span>
                      ) : (
                        <Badge variant="outline" className="border-primary/50 text-primary">
                          unassigned
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{yn(r.contact_status)}</TableCell>
                    <TableCell className="text-sm">{yn(r.interested)}</TableCell>
                    <TableCell className="text-sm">
                      {r.out_of_process ? (
                        <span className="text-destructive">🗄️ {r.oop_reason ?? "OOP"}</span>
                      ) : r.status ? (
                        <Badge className={r.status === "Approved" ? "bg-emerald-600" : ""}>
                          {r.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.country ?? "—"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {!r.assigned_to && !r.assigned_name && !r.out_of_process ? (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => claim(r)}>
                          <Hand className="size-3.5" /> Claim
                        </Button>
                      ) : detailLoading === r.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* pagination */}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => goPage(page - 1)}>
            ← Prev
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <Button
            variant="outline" size="sm" disabled={page + 1 >= pages}
            onClick={() => goPage(page + 1)}
          >
            Next →
          </Button>
        </div>
      ) : null}

      {detail ? (
        <SignupDetailDialog
          key={detail.signup.id}
          detail={detail}
          targets={targets}
          onClose={() => setDetail(null)}
          onChanged={(id) => { openDetail(id); router.refresh(); }}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ detail

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm" dir="auto" title={value}>{value}</p>
    </div>
  );
}

function SignupDetailDialog({
  detail, targets, onClose, onChanged,
}: {
  detail: SignupDetail | null;
  targets: { id: string; label: string }[];
  onClose: () => void;
  onChanged: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comment, setComment] = useState("");
  const [oopMode, setOopMode] = useState(false);
  const [oopReason, setOopReason] = useState("");
  const [country, setCountry] = useState<string | null>(null);

  if (!detail) return null;
  const s = detail.signup;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        onChanged(s.id);
      } else toast.error(res.error ?? "Something went wrong");
    });

  const memberComments = detail.comments.filter((c) => c.author_class === "member");
  const vpComments = detail.comments.filter((c) => c.author_class === "vp");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setOopMode(false); setComment(""); setCountry(null); onClose(); } }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2" dir="auto">
            {s.name}
            <Badge variant="outline">{s.program ?? s.fn}</Badge>
            <Badge variant="outline">{s.batch === "new" ? "New" : "Old"} SUs</Badge>
            {s.out_of_process ? (
              <Badge variant="destructive">Out of Process</Badge>
            ) : s.status ? (
              <Badge className={s.status === "Approved" ? "bg-emerald-600" : ""}>{s.status}</Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            EP {s.ep_id} · signed up {s.signed_up_at ?? "—"} · from the {s.fn} tracker
            {s.last_edited_at ? ` · last edit ${fmtDateTime(s.last_edited_at)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {s.out_of_process ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-semibold text-destructive">🗄️ Out of Process</p>
            {s.oop_reason ? <p className="text-muted-foreground">{s.oop_reason}</p> : null}
            {detail.canVp ? (
              <Button
                size="sm" variant="outline" className="mt-2" disabled={pending}
                onClick={() => run(() => reviveSignup(s.id), "Back in process ↩️")}
              >
                <RotateCcw className="size-3.5" /> Back to active
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* intake data — read-only, straight from the sign-up */}
        {s.phone ? (
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`https://wa.me/${waDigits(s.phone)}`} target="_blank" rel="noreferrer">
                <WhatsAppIcon className="size-4" /> WhatsApp
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`tel:${s.phone}`}><Phone className="size-4" /> {s.phone}</a>
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3 sm:grid-cols-3">
          <Field label="Email" value={s.email} />
          <Field label="Gender" value={s.gender} />
          <Field label="Birth date" value={s.dob} />
          <Field label="Person status" value={s.person_status} />
          <Field label="Referral" value={s.referral} />
          <Field label="Grad year" value={s.grad_year} />
          <Field label="University" value={s.university} />
          <Field label="Background" value={s.background} />
          <Field label="Home LC" value={s.home_lc} />
          <Field label="Campaign" value={s.campaign} />
          <Field label="Reasons not to travel" value={s.reasons_not_travel} />
        </div>

        {/* assignment */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Assigned:</span>
          {detail.assignedLabel ? (
            <Badge variant="outline">{detail.assignedLabel}</Badge>
          ) : (
            <Badge variant="outline" className="border-primary/50 text-primary">unassigned</Badge>
          )}
          {!s.assigned_to && !s.assigned_name && !s.out_of_process ? (
            <Button
              size="sm" disabled={pending}
              onClick={() => run(() => claimSignup(s.id), "It's yours — go get them! 🙌")}
            >
              <Hand className="size-4" /> Claim it
            </Button>
          ) : null}
          {targets.length > 0 && !s.out_of_process ? (
            <Select
              value={s.assigned_to ?? "__none"}
              onValueChange={(v) =>
                run(() => reassignSignup(s.id, v === "__none" ? null : v), "Re-assigned 👥")
              }
            >
              <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Assign to…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— unassigned</SelectItem>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {/* member workflow */}
        {detail.canWork && !s.out_of_process ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Contacted</Label>
              <Select
                value={s.contact_status && /^y/i.test(s.contact_status) ? "Yes" : s.contact_status && /^n/i.test(s.contact_status) ? "No" : "__unset"}
                onValueChange={(v) =>
                  run(
                    () => updateSignupContact(s.id, { contactStatus: v === "__unset" ? null : v }),
                    "Saved"
                  )
                }
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">—</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Interested</Label>
              <Select
                value={s.interested && /^y/i.test(s.interested) ? "Yes" : s.interested && /^n/i.test(s.interested) ? "No" : "__unset"}
                onValueChange={(v) =>
                  run(
                    () => updateSignupContact(s.id, { interested: v === "__unset" ? null : v }),
                    "Saved"
                  )
                }
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">—</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}

        {/* VP-only fields */}
        {detail.canVp ? (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-semibold">VP fields</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Country</Label>
                <Input
                  list="signup-countries"
                  defaultValue={s.country ?? ""}
                  placeholder="Start typing…"
                  onChange={(e) => setCountry(e.target.value)}
                  onBlur={() => {
                    if (country !== null && country !== (s.country ?? ""))
                      run(() => updateSignupVpFields(s.id, { country }), "Country saved 🌍");
                  }}
                />
                <datalist id="signup-countries">
                  {COUNTRIES.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              {s.fn === "OGT" ? (
                <div className="grid gap-1.5">
                  <Label>Sub product</Label>
                  <Select
                    value={s.sub_product ?? "__none"}
                    onValueChange={(v) =>
                      run(
                        () => updateSignupVpFields(s.id, { subProduct: v === "__none" ? null : v }),
                        "Saved"
                      )
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      <SelectItem value="GTa">GTa</SelectItem>
                      <SelectItem value="GTe">GTe</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select
                  value={s.status ?? "__none"}
                  onValueChange={(v) =>
                    run(
                      () => updateSignupVpFields(s.id, { status: v === "__none" ? null : v }),
                      v === "Approved" ? "APPROVED — that's the MOS! 🎉" : "Status saved"
                    )
                  }
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {SIGNUP_STATUSES.map((st) => (
                      <SelectItem key={st} value={st}>{st}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!s.out_of_process ? (
              !oopMode ? (
                <Button
                  size="sm" variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setOopMode(true)}
                >
                  <Archive className="size-3.5" /> Out of Process…
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={oopReason}
                    onChange={(e) => setOopReason(e.target.value)}
                    placeholder="Reason (goes on the sheet too)"
                    className="h-9 flex-1"
                  />
                  <Button
                    size="sm" variant="destructive" disabled={pending}
                    onClick={() =>
                      run(() => setSignupOop(s.id, oopReason), "Archived — out of the sign-ups list 🗄️")
                    }
                  >
                    Archive
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOopMode(false)}>
                    <X className="size-4" />
                  </Button>
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {/* comments — the organized two-class log */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">Comments</p>
          {memberComments.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Member / MM</p>
              {memberComments.map((c) => (
                <div key={c.id} className="rounded-lg bg-muted p-2.5 text-sm" dir="auto">
                  <p className="mb-0.5 text-xs text-muted-foreground">
                    {c.author_name}{c.author_name !== "Sheet" ? ` · ${fmtDateTime(c.created_at)}` : " (from the sheet)"}
                  </p>
                  <p className="whitespace-pre-wrap" dir="auto">{c.body}</p>
                </div>
              ))}
            </div>
          ) : null}
          {vpComments.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-primary">VP</p>
              {vpComments.map((c) => (
                <div key={c.id} className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-sm" dir="auto">
                  <p className="mb-0.5 text-xs text-muted-foreground">
                    {c.author_name}{c.author_name !== "Sheet" ? ` · ${fmtDateTime(c.created_at)}` : " (from the sheet)"}
                  </p>
                  <p className="whitespace-pre-wrap" dir="auto">{c.body}</p>
                </div>
              ))}
            </div>
          ) : null}
          {detail.canWork || detail.canVp ? (
            <div className="flex items-end gap-2">
              <Textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={detail.canVp ? "VP comment — lands in the VP Comment cell" : "Comment — lands in the Comment cell"}
                className="flex-1"
              />
              <Button
                size="sm"
                disabled={pending || !comment.trim()}
                onClick={() =>
                  run(async () => {
                    const res = await addSignupComment(s.id, comment);
                    if (res.ok) setComment("");
                    return res;
                  }, "Comment logged 📝")
                }
              >
                Log
              </Button>
            </div>
          ) : null}
        </div>

        <Button variant="outline" onClick={() => { onClose(); router.refresh(); }}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
