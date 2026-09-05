"use client";

import { useEffect, useRef, useState } from "react";
import { checkAccountNameLive, checkPodioNameLive } from "@/server/actions";
import type { PodioCheck } from "@/lib/podio";

export interface NameCheck {
  status: "checking" | "free" | "duplicate" | "archived" | "blacklist" | "other_world";
  message?: string;
  info?: Record<string, string | null>;
  /** rides on "free": a non-blocking heads-up — archived in another world
   *  (v23.2) or ACTIVE in another world (v33.29, with who holds it) */
  note?: string;
}

/** THE THREE LIVE CHECKS ON AN ACCOUNT NAME (v32 / v32.2), in ONE place.
 *
 *  They were written inline inside the add-account dialog, which meant the
 *  direct-visit form shipped without them — a walk-in could create a duplicate
 *  of an account that already existed, or resurrect a blacklisted name, with
 *  nothing said. Any form that creates an account uses this hook, so the
 *  checks can never drift apart again.
 *
 *  · the DUPLICATE / ARCHIVE check is world-aware (B2C keeps its own archive)
 *  · the PODIO check asks the national form's own search — a warning, never a
 *    block, and silence when Podio is unreachable
 */
export function useAccountNameCheck(
  name: string,
  // v36: nullable — an unclaimed research name has no function yet. The server
  // treats NULL as the ICX world, exactly as the uniqueness index does
  // (0073: `when function is null then 'icx'`), so an unclaimed name still
  // collides with the active ICX names it could be claimed as. That is the
  // point: it stops the same company being researched twice.
  fn: string | null,
  opts?: { excludeId?: string }
) {
  const excludeId = opts?.excludeId;
  const [nameCheck, setNameCheck] = useState<NameCheck | null>(null);
  const checkSeq = useRef(0);
  const trimmed = name.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      checkSeq.current++; // kill any in-flight response for the old text
      setNameCheck(null);
      return;
    }
    setNameCheck({ status: "checking" });
    const seq = ++checkSeq.current;
    const t = setTimeout(async () => {
      const res = await checkAccountNameLive(
        trimmed,
        fn as "IGV" | "IGT" | "B2B" | "BD" | "B2C",
        excludeId
      );
      if (seq !== checkSeq.current) return; // superseded by more typing
      setNameCheck(res.ok ? (res.data as NameCheck) : null);
    }, 450);
    return () => clearTimeout(t);
  }, [trimmed, fn, excludeId]);

  const [podio, setPodio] = useState<PodioCheck | "checking" | null>(null);
  const podioSeq = useRef(0);
  const [podioNonce, setPodioNonce] = useState(0);
  useEffect(() => {
    if (trimmed.length < 2) {
      podioSeq.current++;
      setPodio(null);
      return;
    }
    setPodio("checking");
    const seq = ++podioSeq.current;
    const t = setTimeout(async () => {
      const res = await checkPodioNameLive(trimmed);
      if (seq !== podioSeq.current) return;
      setPodio(res.ok ? (res.data ?? null) : null);
    }, 600);
    return () => clearTimeout(t);
  }, [trimmed, podioNonce]);

  const blocked =
    nameCheck != null && nameCheck.status !== "free" && nameCheck.status !== "checking";

  return { nameCheck, blocked, podio, retryPodio: () => setPodioNonce((n) => n + 1) };
}
