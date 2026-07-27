"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Check, Eye, KeyRound, Loader2, Lock, Mail, MessageSquareHeart, Phone, Sparkles, Target, Upload, Users, UsersRound } from "lucide-react";
import { changePassword, startViewAs, stopViewAs, updateAvatar, updateProfile } from "@/server/actions";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ADMIN_EMAIL, cleanPhone, FUNCTION_COLORS, normalizePhone, PHONE_RE } from "@/lib/types";
import type { MmPlanData, PersonCard, TlPlanData } from "@/server/data";
import { TlPlanForm } from "./tl-plan-form";
import { MmPlanForm } from "./mm-plan-form";
import { WhatsAppIcon } from "./icons";
import { Hint } from "./hint";
import { avatarChoices } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

interface ProfileInfo {
  name: string;
  nickname: string;
  email: string;
  phone: string;
  role: string;
  functions: string[];
  subFunctions: string[];
  teamName: string | null;
  stakeholderName: string | null;
  photoUrl: string | null;
  avatarUrl: string | null;
  googlePhotoUrl: string | null;
  isAdmin: boolean;
  hasPassword: boolean;
  teams: { label: string; name: string }[];
}

export function ProfileView({
  member,
  people,
  tlPlan,
  mmPlan,
  viewAs,
}: {
  member: ProfileInfo;
  /** the viewer's people (TL → team · VP/Director → function · LCP → EB) */
  people: { title: string; people: PersonCard[] } | null;
  /** raising MMs (v22): their opens plan for the peak + monthly actuals */
  tlPlan: TlPlanData | null;
  /** OGX / Consideration MMs (v22.2): their applicants/accepted/approvals plan */
  mmPlan: MmPlanData | null;
  /** REAL-admin only: the test-view picker (survives an active test view) */
  viewAs: {
    activeId: string | null;
    members: { id: string; label: string; role: string; functions: string }[];
  } | null;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(member.nickname);
  const [phone, setPhone] = useState(member.phone);
  const [dirty, setDirty] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [pending, start] = useTransition();

  const phoneOk = PHONE_RE.test(cleanPhone(phone));

  const fixInfoMailto = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(
    "Sodio — my info needs a correction"
  )}&body=${encodeURIComponent(
    `Hi Ahmed,\n\nMy info in the Sodio membership needs a correction.\n\nMy email: ${member.email}\nWhat is wrong: \nWhat it should be: \n\nThanks!`
  )}`;

  const saveProfile = () =>
    start(async () => {
      const res = await updateProfile({ nickname: nickname.trim(), phone: cleanPhone(phone) });
      if (res.ok) {
        toast.success("Profile saved");
        setDirty(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const savePassword = () =>
    start(async () => {
      const res = await changePassword({ current, next });
      if (res.ok) {
        toast.success("Password changed 🔒");
        setCurrent(""); setNext(""); setConfirm("");
      } else toast.error(res.error);
    });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setAvatarOpen(true)}
          className="group relative shrink-0 rounded-full outline-none"
          title="Change your avatar"
        >
          <Avatar className="size-16 ring-2 ring-transparent transition group-hover:ring-primary/40">
            {member.photoUrl ? <AvatarImage src={member.photoUrl} alt="" /> : null}
            <AvatarFallback className="bg-primary text-lg font-bold text-primary-foreground">
              {(member.nickname || member.name).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition group-hover:scale-110">
            <Sparkles className="size-3.5" />
          </span>
        </button>
        <div>
          <h1 className="text-2xl font-bold">{member.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{member.isAdmin ? "Admin" : member.role}</Badge>
            {member.functions.map((f) => (
              <Badge
                key={f}
                className={cn(
                  "border-transparent font-semibold",
                  FUNCTION_COLORS[f]?.bg ?? "bg-primary/15",
                  FUNCTION_COLORS[f]?.text ?? "text-primary"
                )}
              >
                {f}
              </Badge>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAvatarOpen(true)}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Sparkles className="size-3" /> Change avatar
          </button>
        </div>
      </div>

      <AvatarDialog
        open={avatarOpen}
        onOpenChange={setAvatarOpen}
        current={member.avatarUrl}
        googlePhoto={member.googlePhotoUrl}
        fallback={(member.nickname || member.name).slice(0, 2).toUpperCase()}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {/* Editable */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-1.5">
              <Label>Nickname</Label>
              <Input
                value={nickname}
                onChange={(e) => { setNickname(e.target.value); setDirty(true); }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                value={phone}
                inputMode="tel"
                onChange={(e) => { setPhone(e.target.value); setDirty(true); }}
                onBlur={() => {
                  const check = normalizePhone(phone);
                  if (check.ok && check.value !== phone) setPhone(check.value);
                }}
              />
              {phone && !phoneOk ? (
                <p className="text-xs text-destructive">Numbers only, 7–15 digits.</p>
              ) : null}
            </div>
            {dirty ? (
              <Button size="sm" onClick={saveProfile} disabled={pending || !phoneOk || !nickname.trim()}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            ) : null}
          </CardContent>
        </Card>

        {/* Read-only */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4 text-muted-foreground" /> Membership record
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ReadRow label="Full name" value={member.name} />
            <ReadRow label="Email" value={member.email} />
            <ReadRow label="Role" value={member.role} />
            <ReadRow label="Function" value={member.functions.join(", ") || "—"} />
            <ReadRow label="Sub function" value={member.subFunctions.join(", ") || "—"} />
            {member.teamName ? <ReadRow label="Team" value={member.teamName} /> : null}
            {member.stakeholderName ? (
              <ReadRow label="Manager" value={member.stakeholderName} />
            ) : null}
            <a
              href={fixInfoMailto}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Mail className="size-3.5" />
              Wrong info? Click to email the admin to fix it
            </a>
          </CardContent>
        </Card>
      </div>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-muted-foreground" /> Change password
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {member.hasPassword ? (
            <div className="grid gap-1.5">
              <Label>Current password</Label>
              <PasswordInput
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>New password</Label>
            <PasswordInput
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Confirm new password</Label>
            <PasswordInput
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <div className="sm:col-span-3">
            {confirm && next !== confirm ? (
              <p className="mb-2 text-xs text-destructive">Passwords don&apos;t match.</p>
            ) : null}
            <Button
              size="sm"
              onClick={savePassword}
              disabled={pending || next.length < 8 || next !== confirm || (member.hasPassword && !current)}
            >
              {pending ? "Saving…" : "Update password"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Forgot your current password? We&apos;ll email you a fresh one —
              your current password keeps working until you change it.
            </p>
            <RequestResetButton email={member.email} />
          </div>
        </CardContent>
      </Card>

      {member.teams.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-muted-foreground" /> My teams
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {member.teams.map((t) => (
              <div
                key={`${t.label}:${t.name}`}
                className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5"
              >
                <span className="font-semibold">{t.name}</span>
                <span className="text-xs text-muted-foreground">· {t.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {tlPlan ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4 text-muted-foreground" /> My plan —{" "}
              {member.role === "Team Leader" ? "team opens" : "opens"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {member.role === "Team Leader"
                ? "Your team's opens goal per month of the peak. This IS the team goal — the dashboard and the Planning board track it against what your team actually raises."
                : "Your opens goal per month of the peak. Your VP sees it on the Planning board, and the Raised column tracks what you actually close."}
            </p>
          </CardHeader>
          <CardContent>
            <TlPlanForm
              months={tlPlan.months.map((m) => m.month)}
              peakLabel={tlPlan.peakLabel}
              initial={Object.fromEntries(tlPlan.months.map((m) => [m.month, m.opens]))}
              actuals={Object.fromEntries(tlPlan.months.map((m) => [m.month, m.actual]))}
              mode="profile"
            />
          </CardContent>
        </Card>
      ) : null}

      {mmPlan ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4 text-muted-foreground" /> My plan — consideration funnel
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Your applicants · accepted · approvals plan per month of the peak.
              These ARE your goals — your VP sees them on the Planning board and
              in the period reports. Update any time.
            </p>
          </CardHeader>
          <CardContent>
            <MmPlanForm
              months={mmPlan.months.map((m) => m.month)}
              peakLabel={mmPlan.peakLabel}
              initial={Object.fromEntries(
                mmPlan.months.map((m) => [
                  m.month,
                  { applicants: m.applicants, accepted: m.accepted, approvals: m.approvals },
                ])
              )}
              mode="profile"
            />
          </CardContent>
        </Card>
      ) : null}

      {people && people.people.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="size-4 text-muted-foreground" /> {people.title}
              <Badge variant="outline" className="ml-auto font-normal">
                {people.people.length} {people.people.length === 1 ? "person" : "people"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {people.people.map((p) => {
              const wa = p.phone?.replace(/\D/g, "") ?? "";
              const btn =
                "inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary hover:text-primary sm:size-7";
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {p.nickname || p.name}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {p.role}
                        {p.functions.length ? ` · ${p.functions.join(", ")}` : ""}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.team_name ? `${p.team_name} · ` : ""}{p.email}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    <Hint label={`Email ${p.nickname || p.name}`}>
                      <a className={btn} href={`mailto:${p.email}`} aria-label="Email">
                        <Mail className="size-3.5" />
                      </a>
                    </Hint>
                    {p.phone ? (
                      <>
                        <Hint label={`Call ${p.phone}`}>
                          <a className={btn} href={`tel:${p.phone}`} aria-label="Call">
                            <Phone className="size-3.5" />
                          </a>
                        </Hint>
                        <Hint label="WhatsApp">
                          <a
                            className={btn}
                            href={`https://wa.me/${wa}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="WhatsApp"
                          >
                            <WhatsAppIcon className="size-3.5" />
                          </a>
                        </Hint>
                      </>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* system feedback moved here from the sidebar (v21) — the sidebar's
          "LC Feedback" is about PEOPLE; this one is about Sodio itself */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareHeart className="size-4 text-muted-foreground" /> System feedback
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Found a bug? Want a feature? Tell the IM team — every report makes
            Sodio better. 💙
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/feedback">Give feedback</Link>
          </Button>
        </CardContent>
      </Card>

      {viewAs ? <ViewAsCard viewAs={viewAs} /> : null}
    </div>
  );
}

/** Admin test view: experience the whole app as any member — invaluable for
 *  verifying what each role/function actually sees. */
function ViewAsCard({
  viewAs,
}: {
  viewAs: {
    activeId: string | null;
    members: { id: string; label: string; role: string; functions: string }[];
  };
}) {
  const router = useRouter();
  const [target, setTarget] = useState(viewAs.activeId ?? "");
  const [pending, start] = useTransition();
  const active = viewAs.members.find((m) => m.id === viewAs.activeId) ?? null;

  const begin = () =>
    start(async () => {
      const res = await startViewAs(target);
      if (res.ok) {
        toast.success(`👁 Now viewing as ${res.data?.name} — hit Exit on the banner to come back.`);
        router.refresh();
      } else toast.error(res.error);
    });

  const end = () =>
    start(async () => {
      const res = await stopViewAs();
      if (res.ok) {
        toast.success("Back to yourself 👋");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="size-4 text-warning" /> Test view (admin)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          See and use the whole system exactly as another member — dashboard,
          accounts, permissions, everything. Actions you take while testing are
          <b> real and recorded as them</b>, so look, don&apos;t touch. 😉
        </p>
        {active ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-transparent bg-warning/15 text-warning">
              Active: {active.label} · {active.role}
            </Badge>
            <Button size="sm" variant="outline" onClick={end} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Exit test view
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={target || undefined} onValueChange={setTarget}>
            <SelectTrigger className="h-9 w-64 max-w-full">
              <SelectValue placeholder="Pick a member…" />
            </SelectTrigger>
            <SelectContent>
              {viewAs.members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} · {m.role}
                  {m.functions ? ` · ${m.functions}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={begin}
            disabled={pending || !target || target === viewAs.activeId}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            View as
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RequestResetButton({ email }: { email: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-2"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const { requestPasswordReset } = await import("@/server/auth-actions");
          const res = await requestPasswordReset(email);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        })
      }
    >
      {pending ? "Sending…" : "📬 Email me a new password"}
    </Button>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words font-medium">{value}</span>
    </div>
  );
}

/** Downscale an uploaded image to a ~256px square JPEG data URL (keeps the DB
 *  row small and strips EXIF). Center-crops to a circle-friendly square. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Pick a fun character avatar, upload your own, or go back to the Google photo. */
function AvatarDialog({
  open, onOpenChange, current, googlePhoto, fallback,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: string | null;
  googlePhoto: string | null;
  fallback: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [choices] = useState(() => avatarChoices());
  const [selected, setSelected] = useState<string | null>(current);
  const [uploaded, setUploaded] = useState<string | null>(
    current?.startsWith("data:") ? current : null
  );
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();

  const onUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file (png, jpg, webp).");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setUploaded(dataUrl);
      setSelected(dataUrl);
    } catch {
      toast.error("Couldn't read that image — try another one.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = () =>
    start(async () => {
      const res = await updateAvatar(selected);
      if (res.ok) {
        toast.success("Avatar updated 🎉");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const optionBtn = (url: string | null, key: string, title?: string) => (
    <button
      key={key}
      type="button"
      title={title}
      onClick={() => setSelected(url)}
      className={cn(
        "relative aspect-square rounded-full ring-2 transition hover:scale-105",
        selected === url ? "ring-primary" : "ring-transparent"
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full rounded-full bg-muted object-cover" loading="lazy" />
      ) : (
        <Avatar className="size-full">
          {googlePhoto ? <AvatarImage src={googlePhoto} alt="" /> : null}
          <AvatarFallback className="bg-primary text-sm font-bold text-primary-foreground">
            {fallback}
          </AvatarFallback>
        </Avatar>
      )}
      {selected === url ? (
        <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      ) : null}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Pick your avatar
          </DialogTitle>
          <DialogDescription>
            Upload your own photo, choose a fun character, or use your Google
            photo. It shows on your profile and in the sidebar.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto p-1">
          {/* Upload + Google photo */}
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Yours</p>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-primary/40 text-primary transition hover:scale-105 hover:border-primary"
                title="Upload your own picture"
              >
                <Upload className="size-4" />
                <span className="text-[9px] font-semibold">{busy ? "…" : "Upload"}</span>
              </button>
              {uploaded ? optionBtn(uploaded, "uploaded", "Your uploaded picture") : null}
              {optionBtn(null, "google", "Your Google photo / initials")}
            </div>
          </div>

          {/* Fun characters (the first is a classic bearded one) */}
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Fun characters</p>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
              {choices.map((c, i) => optionBtn(c.url, `fun-${i}`))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || busy}>
            {pending ? "Saving…" : "Use this avatar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
