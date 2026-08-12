"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "./hint";

/** Copies an account name to the clipboard — the Podio form wants it typed
 *  exactly, and retyping is how "Al Safwa" becomes "Alsafwa". Shared by the
 *  Raising list, the Archived tab and the account page (v33.39). */
export function CopyNameButton({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  return (
    <Hint label={done ? "Copied" : "Copy name"}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground hover:text-primary"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          navigator.clipboard.writeText(name).then(
            () => {
              setDone(true);
              toast.success("Copied");
              setTimeout(() => setDone(false), 1500);
            },
            () => toast.error("Couldn't copy — select the name and copy it by hand.")
          );
        }}
      >
        {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </Hint>
  );
}
