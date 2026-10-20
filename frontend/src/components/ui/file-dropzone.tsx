"use client";

import { FileText, UploadCloud, X } from "lucide-react";
import { useRef, useState, type ComponentProps, type DragEvent } from "react";
import { cn } from "@/lib/cn";
import { RESUME_ACCEPT, formatBytes } from "@/lib/resume-file";

interface FileDropzoneProps extends Pick<ComponentProps<"input">, "id" | "aria-describedby" | "aria-invalid"> {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
  accept?: string;
}

/**
 * Drag-and-drop plus a real, keyboard-focusable file input (the whole zone is its label), so
 * it works with a mouse, keyboard and screen reader alike. Validation lives with the caller.
 */
export function FileDropzone({ file, onFile, disabled, accept = RESUME_ACCEPT, id, ...aria }: FileDropzoneProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-control border border-border-strong bg-surface p-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-tint text-primary">
          <FileText className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{file.name}</p>
          <p className="text-small text-muted">{formatBytes(file.size)}</p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (input.current) input.current.value = "";
            onFile(null);
          }}
          aria-label={`Remove ${file.name}`}
          className="grid size-9 place-items-center rounded-control text-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-50"
        >
          <X className="size-[18px]" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-border-strong bg-surface px-6 py-10 text-center",
        "transition-[border-color,background-color] duration-150 hover:border-primary/60 hover:bg-primary-tint/40",
        "has-[:focus-visible]:border-primary has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-primary/15",
        "has-[[aria-invalid=true]]:border-danger",
        over && "border-primary bg-primary-tint",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <UploadCloud className="size-8 text-primary" aria-hidden />
      <span className="font-medium">Drop your resume here, or <span className="text-primary underline underline-offset-4">browse</span></span>
      <span className="text-small text-muted">PDF or DOCX, up to 5 MB</span>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        {...aria}
      />
    </label>
  );
}
