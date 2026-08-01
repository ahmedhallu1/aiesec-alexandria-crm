"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { completeOnboarding } from "@/server/actions";
import { normalizePhone, ADMIN_EMAIL, cleanPhone, PHONE_RE } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface MemberInfo {
  name: string;
  nickname: string;
  email: string;
  phone: string;
  role: string;
  functions: string[];
  subFunctions: string[];
  teamName: string | null;
  stakeholderName: string | null;
}

export function OnboardingForm({ member }: { member: MemberInfo }) {
  const router = useRouter();
  const [name, setName] = useState(member.name);
  const [nickname, setNickname] = useState(member.nickname);
  const [phone, setPhone] = useState(member.phone);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();

  const phoneOk = PHONE_RE.test(cleanPhone(phone));
  const passwordOk = password.length >= 8 && password === confirm;
  const ready = name.trim().length >= 2 && nickname.trim().length >= 1 && phoneOk && passwordOk;

  const fixInfoMailto = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(
    "Elevate — my info needs a correction"
  )}&body=${encodeURIComponent(
    `Hi Ahmed,\n\nMy info in the Elevate membership needs a correction.\n\nMy email: ${member.email}\nWhat is wrong: \nWhat it should be: \n\nThanks!`
  )}`;

  const submit = () =>
    start(async () => {
      const res = await completeOnboarding({
        name: name.trim(),
        nickname: nickname.trim(),
        phone: cleanPhone(phone),
        password,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("You're all set — welcome to Elevate 💙");
      router.replace("/");
      router.refresh();
    });

  return (
    <div className="grid gap-5">
      {/* Confirm identity */}
      <div className="grid gap-3">
        <p className="text-sm font-semibold">1 · Confirm your info</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Full name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Nickname *</Label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="What the LC calls you"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Phone number *</Label>
          <Input
            value={phone}
            onBlur={() => {
              const check = normalizePhone(phone);
              if (check.ok && check.value !== phone) setPhone(check.value);
            }}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01XXXXXXXXX"
          />
          {phone && !phoneOk ? (
            <p className="text-xs text-destructive">Numbers only, 7–15 digits.</p>
          ) : null}
        </div>
      </div>

      {/* Read-only membership info */}
      <div className="rounded-xl border bg-muted/40 p-4">
        <p className="mb-2 text-sm font-semibold">Your membership record</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-medium">{member.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd className="font-medium">{member.role}</dd>
          <dt className="text-muted-foreground">Function</dt>
          <dd className="font-medium">{member.functions.join(", ") || "—"}</dd>
          <dt className="text-muted-foreground">Sub function</dt>
          <dd className="font-medium">{member.subFunctions.join(", ") || "—"}</dd>
          {member.teamName ? (
            <>
              <dt className="text-muted-foreground">Team</dt>
              <dd className="font-medium">{member.teamName}</dd>
            </>
          ) : null}
          {member.stakeholderName ? (
            <>
              <dt className="text-muted-foreground">Manager</dt>
              <dd className="font-medium">{member.stakeholderName}</dd>
            </>
          ) : null}
        </dl>
        <a href={fixInfoMailto} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
          <Mail className="size-3.5" />
          Something wrong here? Click to email the admin to fix it
        </a>
      </div>

      <Separator />

      {/* Password */}
      <div className="grid gap-3">
        <p className="text-sm font-semibold">2 · Set your password</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>New password *</Label>
            <PasswordInput
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Confirm password *</Label>
            <PasswordInput
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        {confirm && password !== confirm ? (
          <p className="text-xs text-destructive">Passwords don&apos;t match.</p>
        ) : null}
      </div>

      <Button size="lg" onClick={submit} disabled={!ready || pending}>
        {pending ? "Saving…" : "Save & enter Elevate"}
      </Button>
    </div>
  );
}
