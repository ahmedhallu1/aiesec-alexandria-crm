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

/** DIALOGS ARE MOVABLE (v33.8).
 *
 *  A dialog covers the thing you opened it about: logging a contact hides the
 *  history you want to check, editing columns hides the table. People close
 *  it, look, and reopen — losing what they typed. Drag it aside by its header
 *  instead.
 *
 *  MOVED VIA THE DOM, NOT VIA STATE. The first version set React state on
 *  every pointermove: each move re-rendered the whole dialog, the transform
 *  fought Radix's own `translate(-50%,-50%)` and its open animation, so the
 *  thing jumped on grab and faded on release. Now the drag writes
 *  `style.transform` directly — no re-render, nothing for React or Radix to
 *  overwrite — which is exactly how a desktop window behaves.
 *
 *  Desktop only: on a phone the dialog IS the screen. Bounded so it can never
 *  be thrown out of reach, and it starts centred every time it opens.
 */
function useDialogDrag() {
  const ref = React.useRef<HTMLDivElement>(null)
  const offset = React.useRef({ x: 0, y: 0 })

  const apply = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    // THE `translate` LONGHAND, NOT `transform` (v33.9). Tailwind v4 centres
    // this element with `translate: var(--tw-translate-x) var(--tw-translate-y)`
    // — the CSS translate PROPERTY. Writing `transform` doesn't replace that,
    // it COMPOSES with it, so the dialog jumped half its own size up and left
    // the moment a drag began. Writing `translate` overrides the value cleanly
    // and still leaves `transform` free for Radix's zoom animation.
    el.style.translate = `calc(-50% + ${offset.current.x}px) calc(-50% + ${offset.current.y}px)`
  }, [])

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current
      if (!el) return
      // a control inside the header keeps its click
      if (
        (e.target as HTMLElement).closest(
          "button,a,input,select,textarea,[role='button'],[role='combobox']"
        )
      )
        return
      if (!window.matchMedia("(min-width: 768px) and (pointer: fine)").matches) return

      const startX = e.clientX
      const startY = e.clientY
      const base = { ...offset.current }
      const box = el.getBoundingClientRect()
      // leave a grabbable strip on screen in every direction
      const maxX = (window.innerWidth + box.width) / 2 - 80
      const maxY = (window.innerHeight + box.height) / 2 - 60

      el.style.transition = "none"
      el.style.animation = "none" // don't let the open animation replay mid-drag
      document.body.style.userSelect = "none"

      const move = (ev: PointerEvent) => {
        offset.current = {
          x: Math.max(-maxX, Math.min(maxX, base.x + ev.clientX - startX)),
          y: Math.max(-maxY, Math.min(maxY, base.y + ev.clientY - startY)),
        }
        apply()
      }
      const up = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
        window.removeEventListener("pointercancel", up)
        document.body.style.userSelect = ""
      }
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
      window.addEventListener("pointercancel", up)
    },
    [apply]
  )

  return { ref, onPointerDown }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  // Radix mounts a fresh Content each time the dialog opens, so it always
  // starts centred without any extra bookkeeping
  const { ref, onPointerDown } = useDialogDrag()
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
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          // MOBILE-SAFE BY DEFAULT (v33.9). A dialog taller than the phone —
          // which any form becomes once the keyboard is up — used to run off
          // the screen with no way to reach its buttons, and every dialog had
          // to remember to opt in. The base caps the height and scrolls, so
          // anything built later is safe without thinking about it. Callers
          // can still override: their classes come after these.
          "max-h-[90dvh] overflow-y-auto overscroll-contain",
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
