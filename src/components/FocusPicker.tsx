import { Check } from "lucide-react";
import { FOCUSES, type FocusId } from "../domain/focus";
import { cn } from "../lib/utils";

/**
 * The multi-select focus grid.
 *
 * One component serves both the first-run prompt and Settings, so the two can
 * never drift into offering different focuses — the single most annoying class
 * of settings bug. Selection is explicitly multi-select and the copy says so,
 * because a grid of toggles that accepts several is not self-evident.
 */
export function FocusPicker({
  selected,
  onToggle,
  idPrefix,
}: {
  selected: readonly FocusId[];
  onToggle: (id: FocusId) => void;
  /** Namespaces the checkbox ids so two pickers never collide in the DOM. */
  idPrefix: string;
}) {
  return (
    <div role="group" aria-label="What matters to you" className="grid grid-cols-2 gap-2">
      {FOCUSES.map((f) => {
        const on = selected.includes(f.id);
        return (
          <button
            key={f.id}
            id={`${idPrefix}-${f.id}`}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(f.id)}
            className={cn(
              "flex items-center gap-2.5 rounded-[16px] border px-3 py-3 text-left transition-colors",
              on
                ? "border-[var(--wx-accent)]/60 bg-[var(--wx-accent)]/15"
                : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border transition-colors",
                on ? "border-transparent bg-[var(--wx-accent)] text-black" : "border-white/25",
              )}
            >
              {on ? <Check size={13} strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium leading-tight">{f.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--ink-faint)]">
                {f.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
