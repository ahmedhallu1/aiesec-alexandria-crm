"use client";

import "@/components/no-peace/no-peace.css";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { stencil } from "@/components/no-peace/fonts";

/** If the board ever throws (a bad snapshot, a render bug), the public page
 *  shows this instead of Next's blank error screen — in the board's own
 *  colours, with one way out: fetch a fresh snapshot from the server. */
export default function NoPeaceError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error("[no-peace]", error);
  }, [error]);
  const reload = () => {
    if (retry) return retry();
    router.refresh();
    reset?.();
  };
  return (
    <div className={`np ${stencil.variable}`}>
      <main className="np-wrap np-fail">
        <h1 className="np-h2">The board lost its signal</h1>
        <p>Something went wrong showing the standings. Nothing is lost — the numbers are safe in Sodio.</p>
        <button type="button" className="np-btn np-btn-primary" onClick={reload}>
          Reload
        </button>
      </main>
    </div>
  );
}
