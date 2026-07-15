"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck, Check, KeyRound, Loader2, Lock, Mail, Sparkles, Upload, Users } from "lucide-react";
import { changePassword, diagnoseCalendar, updateAvatar, updateProfile } from "@/server/actions";
import { ADMIN_EMAIL, cleanPhone, FUNCTION_COLORS, PHONE_RE } from "@/lib/types";
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

export function ProfileView({ member }: { member: ProfileInfo }) {
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

      {member.isAdmin ? <CalendarHealthCard /> : null}
    </div>
  );
}

/** Admin-only calendar diagnostics — tells you exactly which visit-calendar
 *  tiers are working (and how to fix Tier 2 if the mailbox token needs scope). */
function CalendarHealthCard() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await diagnoseCalendar();
      if (res.ok) setLines(res.data?.lines ?? []);
      else toast.error(res.error);
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="size-4 text-muted-foreground" /> Calendar health (admin)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Checks how visit invites reach calendars. Run it after scheduling a test
          visit if events aren&apos;t showing up.
        </p>
        <Button size="sm" variant="outline" onClick={run} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
          {pending ? "Checking…" : "Run calendar check"}
        </Button>
        {lines ? (
          <ul className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
            {lines.map((l, i) => (
              <li key={i} className="leading-snug">{l}</li>
            ))}
          </ul>
        ) : null}
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
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
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
