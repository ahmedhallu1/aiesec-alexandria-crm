"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, KeyRound, Lock, Mail, Sparkles } from "lucide-react";
import { changePassword, updateAvatar, updateProfile } from "@/server/actions";
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
              Forgot your current password? Request a reset — then sign in with
              Google and set a new one.
            </p>
            <RequestResetButton email={member.email} />
          </div>
        </CardContent>
      </Card>
    </div>
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
      {pending ? "Sending…" : "🔑 Ask the IM team for a reset"}
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

/** Pick a fun character avatar (or go back to the Google photo). */
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
  const [choices] = useState(() => avatarChoices());
  const [selected, setSelected] = useState<string | null>(current);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await updateAvatar(selected);
      if (res.ok) {
        toast.success("Avatar updated 🎉");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Pick your avatar
          </DialogTitle>
          <DialogDescription>
            Choose a fun character — or use your Google photo. It shows on your
            profile and in the sidebar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[50vh] grid-cols-4 gap-3 overflow-y-auto p-1 sm:grid-cols-6">
          {/* Google photo / initials fallback */}
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={cn(
              "relative flex aspect-square items-center justify-center rounded-full ring-2 transition hover:scale-105",
              selected === null ? "ring-primary" : "ring-transparent"
            )}
            title="Use your Google photo"
          >
            <Avatar className="size-full">
              {googlePhoto ? <AvatarImage src={googlePhoto} alt="" /> : null}
              <AvatarFallback className="bg-primary text-sm font-bold text-primary-foreground">
                {fallback}
              </AvatarFallback>
            </Avatar>
            {selected === null ? (
              <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3" />
              </span>
            ) : null}
          </button>

          {choices.map((c) => (
            <button
              key={c.url}
              type="button"
              onClick={() => setSelected(c.url)}
              className={cn(
                "relative aspect-square rounded-full ring-2 transition hover:scale-105",
                selected === c.url ? "ring-primary" : "ring-transparent"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.url} alt="" className="size-full rounded-full bg-muted" loading="lazy" />
              {selected === c.url ? (
                <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Use this avatar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
