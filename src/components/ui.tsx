import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";

/** Quiet circular control. 40px keeps it above the comfortable touch floor. */
export function IconButton({
  onClick,
  label,
  children,
  active,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors",
        active
          ? "bg-white/20 text-white"
          : "text-[var(--ink-soft)] hover:bg-white/12 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Bottom sheet. Opaque rather than glassy, so it reads as a surface that belongs
 * to the app instead of a floating pane of glass.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  "data-testid": testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  "data-testid"?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="wx-sheet-root fixed inset-0 z-50 flex items-end justify-center">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/55" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="wx-sheet-panel relative z-10 max-h-[86dvh] w-full max-w-[430px] overflow-y-auto rounded-t-[28px] bg-[#0a111c] p-5 pb-8 shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.8)]"
        style={{ boxShadow: "inset 0 1px 0 0 rgb(255 255 255 / 0.09)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-[18px] font-semibold leading-snug tracking-tight">{title}</h2>
          <IconButton onClick={onClose} label="Close">
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Grouping label, used sparingly and never on every section. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-faint)]">
      {children}
    </h2>
  );
}
