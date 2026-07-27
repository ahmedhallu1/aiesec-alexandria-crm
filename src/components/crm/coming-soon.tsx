"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WalkingLoader } from "./walking-loader";

const LINES = [
  "The Blue Man is walking your module over here. He refuses to run — it's about the journey. 🚶",
  "Your workspace is 87% vibes, 13% code right now. We're fixing the ratio.",
  "Plot twist: the ICX members thought THEY were the beta testers. It was you all along.",
  "Somewhere, Ahmed is typing very fast so this page can stop existing.",
  "Breaking news: your module is stuck in traffic on the Corniche. ETA: soon™.",
  "We asked the Blue Man for an ETA. He just kept walking. Legend.",
  "Your dashboard is still in the oven. Opening it early would deflate it, like a cheesecake.",
  "Rome wasn't built in a day. Neither was Sodio. Rome also didn't have dark mode.",
];

/** Blurred mock workspace shown to members whose function has no module yet. */
export function ComingSoon({ functions }: { functions: string[] }) {
  const label = functions.length > 0 ? functions.join(" · ") : "your area";
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * LINES.length));

  // rotate the joke every few seconds — keeps the wait entertaining
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % LINES.length), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative min-h-[70vh] overflow-hidden rounded-2xl">
      {/* blurred fake dashboard behind the overlay */}
      <div aria-hidden className="pointer-events-none select-none space-y-4 blur-[7px]">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-2 pt-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-2 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="space-y-3 pt-5">
            {[80, 62, 45, 30, 18].map((w, i) => (
              <div key={i} className="h-7 rounded-md bg-primary/30" style={{ width: `${w}%` }} />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2.5 pt-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/55 p-6 text-center">
        <WalkingLoader label={null} className="py-0" />
        <h1 className="text-2xl font-black tracking-tight">
          Soon<span className="text-primary">.</span>
        </h1>
        <p key={idx} className="fade-swap max-w-md text-sm font-medium">
          {LINES[idx]}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          {`Sodio currently covers ICX Raising (IGV · IGT · B2B & BD), B2C and Talent Management. The ${label} workspace is on the roadmap — you'll get an email the moment it opens. 💙`}
        </p>
      </div>
    </div>
  );
}
