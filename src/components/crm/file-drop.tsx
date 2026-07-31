"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

/** A VISIBLE drag-and-drop file zone (v27) — every attachment point in Sodio
 *  uses this instead of a bare <input type="file">: drop a file on it or
 *  click/tap to browse. Keyboard accessible (Enter/Space open the picker). */
export function FileDrop({
  onFile,
  onFiles,
  accept,
  multiple = false,
  label = "Drop the file here — or click to browse",
  hint,
  fileName,
  disabled,
  className,
}: {
  onFile?: (file: File) => void;
  /** multi-file mode: receives every dropped/picked file */
  onFiles?: (files: File[]) => void;
  /** the <input accept> filter, e.g. "image/*" or ".csv,.xlsx" */
  accept?: string;
  multiple?: boolean;
  label?: string;
  /** small second line, e.g. "any format · up to 25 MB" */
  hint?: string;
  /** the currently picked file's name(s) — shown inside the zone */
  fileName?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (list: FileList | null | undefined) => {
    if (disabled || !list || list.length === 0) return;
    const files = Array.from(list);
    if (multiple && onFiles) onFiles(files);
    else if (onFile) onFile(files[0]);
    else if (onFiles) onFiles(files.slice(0, 1));
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-input bg-muted/30 px-4 py-6 text-center transition-all",
        "hover:border-primary/60 hover:bg-primary/5",
        over && "scale-[1.01] border-primary bg-primary/10",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      <Upload
        className={cn(
          "size-5 text-muted-foreground transition-transform",
          over && "-translate-y-0.5 text-primary"
        )}
      />
      <p className="text-sm font-medium">
        {fileName ? (
          <span className="text-primary" dir="auto">📎 {fileName}</span>
        ) : (
          label
        )}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = ""; // same file re-pickable
        }}
      />
    </div>
  );
}
