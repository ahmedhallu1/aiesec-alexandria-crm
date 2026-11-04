"use client";

import "@/components/race/race.css";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** If the race board ever throws, the public page shows this instead of a
 *  blank screen — in the board's colours, with one way out. */
export default function RaceError({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error("[alex-vs-must]", error);
  }, [error]);
  return (
    <div className="rc" style={{ "--home": "#037ef3", "--rival": "#ff9f1c" } as React.CSSProperties}>
      <main className="rc-desk">
        <div className="rc-wrap">
          <div className="rc-desk-card">
            <h1>The race lost its signal</h1>
            <p className="rc-desk-note">Something went wrong showing the board. Nothing is lost — the numbers are safe in Sodio.</p>
            <button
              type="button"
              className="rc-btn rc-btn-go"
              onClick={() => {
                router.refresh();
                reset?.();
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
