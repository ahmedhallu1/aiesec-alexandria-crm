import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Blurred mock workspace shown to members whose function has no module yet. */
export function ComingSoon({ functions }: { functions: string[] }) {
  const label = functions.length > 0 ? functions.join(" · ") : "your area";
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
        <div className="animate-bounce text-5xl">✨</div>
        <h1 className="text-2xl font-black tracking-tight">
          Soon<span className="text-primary">.</span>
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {`The ${label} workspace is being built. The CRM currently covers the ICX Raising process (IGV & IGT) — stay tuned, you'll get an email the moment your module opens. 💙`}
        </p>
      </div>
    </div>
  );
}
