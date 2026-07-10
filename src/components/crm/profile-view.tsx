"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Lock, Mail } from "lucide-react";
import { changePassword, updateProfile } from "@/server/actions";
import { ADMIN_EMAIL, cleanPhone, FUNCTION_COLORS, PHONE_RE } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [pending, start] = useTransition();

  const phoneOk = PHONE_RE.test(cleanPhone(phone));

  const fixInfoMailto = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(
    "CRM — my info needs a correction"
  )}&body=${encodeURIComponent(
    `Hi Ahmed,\n\nMy info in the CRM membership needs a correction.\n\nMy email: ${member.email}\nWhat is wrong: \nWhat it should be: \n\nThanks!`
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
        <Avatar className="size-16">
          {member.photoUrl ? <AvatarImage src={member.photoUrl} alt="" /> : null}
          <AvatarFallback className="bg-primary text-lg font-bold text-primary-foreground">
            {(member.nickname || member.name).slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
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
        </div>
      </div>

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
              <Input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>New password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Confirm new password</Label>
            <Input
              type="password"
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
              Forgot your current password? Request a reset — your next sign-in
              will accept any password and walk you through setting a new one.
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
