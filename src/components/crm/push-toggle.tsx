"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  VAPID_PUBLIC_KEY,
  currentSubscription,
  pushPermission,
  pushSupported,
  registerPushWorker,
  subscribeToPush,
  toInput,
} from "@/lib/push-client";
import {
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from "@/server/actions";

/** NOTIFICATIONS ON THIS DEVICE (v35).
 *
 *  Per DEVICE, not per member, and the row says so: a member turns it on
 *  where they want to be reached. It is the same switch in the browser and in
 *  the Android app — the Play build is a TWA around this same site, so a
 *  subscription made inside the app is a subscription like any other.
 */
export function PushToggle({ label = "Notifications on this device" }: { label?: string }) {
  const [state, setState] = useState<
    "loading" | "unsupported" | "unconfigured" | "denied" | "on" | "off"
  >("loading");
  const [busy, start] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pushSupported()) return alive && setState("unsupported");
      if (!VAPID_PUBLIC_KEY) return alive && setState("unconfigured");
      const permission = pushPermission();
      if (permission === "denied") return alive && setState("denied");
      const sub = await currentSubscription();
      if (!alive) return;
      setState(sub && permission === "granted" ? "on" : "off");
      // RE-SYNC A SUBSCRIPTION THAT IS ALREADY LIVE. A push service rotates an
      // endpoint on its own schedule, and a rotated one the server never heard
      // about is a phone that has silently stopped receiving anything.
      if (sub && permission === "granted") {
        const input = toInput(sub);
        if (input) await savePushSubscription(input).catch(() => {});
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enable = useCallback(() => {
    start(async () => {
      const input = await subscribeToPush().catch((e) => {
        console.error("[push] subscribe failed:", e);
        return null;
      });
      if (!input) {
        // "denied" and "they closed the prompt" are different answers and the
        // fix is different — say which one happened
        if (pushPermission() === "denied") {
          setState("denied");
          toast.error("Notifications are blocked for Sodio in this browser.");
        } else {
          toast.error("Couldn't turn notifications on here.");
        }
        return;
      }
      const res = await savePushSubscription(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setState("on");
      toast.success("🔔 This device will get Sodio's notifications now.");
    });
  }, []);

  const disable = useCallback(() => {
    start(async () => {
      const sub = await currentSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
      toast.success("Notifications off on this device.");
    });
  }, []);

  if (state === "loading")
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />;

  if (state === "unsupported" || state === "unconfigured" || state === "denied") {
    const why =
      state === "unsupported"
        ? "This browser can't"
        : state === "unconfigured"
          ? "Not set up yet"
          : "Blocked in this browser";
    const title =
      state === "denied"
        ? "You (or the browser) blocked notifications for Sodio. Turn them back on in the site settings, then come back here."
        : state === "unconfigured"
          ? "The IM team hasn't added the push keys to this deployment yet."
          : "Notifications need a browser that supports Web Push — Safari on an iPhone needs Sodio added to the Home Screen first.";
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
        title={title}
      >
        {why}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {state === "on" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const res = await sendTestPush();
              if (res.ok) toast.success("Sent — it should arrive in a second.");
              else toast.error(res.error);
            })
          }
        >
          <BellRing className="size-3.5" /> Test it
        </Button>
      ) : null}
      <Switch
        checked={state === "on"}
        disabled={busy}
        onCheckedChange={(v) => (v ? enable() : disable())}
        aria-label={label}
      />
    </div>
  );
}

/** Keeps the worker registered on every page (which is also how the browser
 *  picks up a new version of it), and quietly re-registers a device whose
 *  endpoint has rotated. Never asks for permission — that needs a real click,
 *  and it lives on the settings row. */
export function PushSync() {
  useEffect(() => {
    if (!pushSupported() || !VAPID_PUBLIC_KEY) return;
    (async () => {
      await registerPushWorker();
      if (pushPermission() !== "granted") return;
      const sub = await currentSubscription();
      if (!sub) return;
      const input = toInput(sub);
      if (input) await savePushSubscription(input).catch(() => {});
    })();
  }, []);
  return null;
}
