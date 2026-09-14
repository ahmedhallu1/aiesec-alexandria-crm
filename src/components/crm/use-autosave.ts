"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AutosaveController,
  type AutosaveStatus,
  type SaveResult,
} from "@/lib/autosave";

/** React wrapper around AutosaveController (see src/lib/autosave.ts for WHY).
 *
 *  Every way out of a page flushes what was typed:
 *    · a pause in typing (the debounce),
 *    · the caller's onBlur → `flush()`,
 *    · the tab being hidden — tapping WhatsApp or Call on a phone,
 *    · `pagehide` (the tab closing),
 *    · unmount — navigating to another page inside Sodio.
 *  And while something is still unsaved, closing/reloading the tab asks first. */
export function useAutosave<T>(
  save: (value: T) => Promise<SaveResult>,
  opts: { delay?: number } = {}
): {
  status: AutosaveStatus;
  change: (value: T, blockedReason?: string | null) => void;
  flush: () => Promise<void>;
} {
  const [status, setStatus] = useState<AutosaveStatus>({ kind: "idle" });
  const [ctrl] = useState(
    () =>
      new AutosaveController<T>({
        save,
        delay: opts.delay ?? 1000,
        onStatus: setStatus,
      })
  );
  // the latest closure (it reads the latest props) — swapped after render
  useEffect(() => {
    ctrl.setSave(save);
  });

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void ctrl.flush();
    };
    const onPageHide = () => void ctrl.flush();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!ctrl.unsaved) return;
      void ctrl.flush();
      e.preventDefault();
      // legacy browsers need a returnValue to show the prompt
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // leaving the page INSIDE Sodio: the JS keeps running, so the save lands
      void ctrl.flush();
    };
  }, [ctrl]);

  const change = useCallback(
    (value: T, blockedReason: string | null = null) => ctrl.change(value, blockedReason),
    [ctrl]
  );
  const flush = useCallback(() => ctrl.flush(), [ctrl]);
  return { status, change, flush };
}
