import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // NOT bg-accent. --accent is the identity's PURPLE SURFACE, meant for accent
      // chips; a page full of pulsing purple blocks reads as an error state
      // rather than as loading. --muted is the neutral surface this wants.
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
