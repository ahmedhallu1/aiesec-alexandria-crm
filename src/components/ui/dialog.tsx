"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

/** DIALOGS ARE MOVABLE (v33.7).
 *
 *  A dialog covers the thing you opened it about: logging a contact hides the
 *  account's history, editing columns hides the table you are editing them
 *  for. The answer people reach for is closing it, checking, and reopening —
 *  losing whatever they had typed. Now you can drag it aside by its header
 *  and put it back.
 *
 *  Desktop only, deliberately: on a phone the dialog IS the screen, so there
 *  is nowhere to drag it to. Dragging is bounded to the viewport so a dialog
 *  can never be thrown off-screen, and the offset resets each time it opens.
 */
function useDialogDrag(open: boolean | undefined) {
  const [offset, setOffset] = React.useState<{ x: number; y: number } | null>(null)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setOffset(null)
  }, [open])

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    // never steal a click from a control that lives in the header
    if ((e.target as HTMLElement).closest("button,a,input,select,textarea,[role='button']"))
      return
    if (!window.matchMedia("(min-width: 768px) and (pointer: fine)").matches) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const box = ref.current?.getBoundingClientRect()
    let base = { x: 0, y: 0 }
    setOffset((o) => {
      base = o ?? { x: 0, y: 0 }
      return base
    })
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      // keep at least a corner of the dialog reachable
      const maxX = window.innerWidth / 2 + (box ? box.width / 2 - 60 : 0)
      const maxY = window.innerHeight / 2 + (box ? box.height / 2 - 40 : 0)
      setOffset({
        x: Math.max(-maxX, Math.min(maxX, base.x + dx)),
        y: Math.max(-maxY, Math.min(maxY, base.y + dy)),
      })
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.style.userSelect = ""
    }
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [])

  return { ref, offset, onPointerDown }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  // Radix mounts a fresh Content each time the dialog opens, so the offset
  // starts at zero every time without any extra bookkeeping
  const { ref, offset, onPointerDown } = useDialogDrag(true)
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        onPointerDownCapture={(e) => {
          // only the HEADER is a handle — dragging from the body would fight
          // with selecting text in it
          if ((e.target as HTMLElement).closest("[data-slot='dialog-header']"))
            onPointerDown(e)
        }}
        style={
          offset
            ? {
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                transition: "none",
              }
            : undefined
        }
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          "[&_[data-slot='dialog-header']]:md:cursor-grab [&_[data-slot='dialog-header']]:md:active:cursor-grabbing",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
