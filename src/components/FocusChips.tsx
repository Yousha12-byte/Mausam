import { useCallback, useEffect, useRef, useState } from "react";
import { FOCUS_BY_ID, FOCUSES, type FocusId } from "../domain/focus";
import { cn } from "../lib/utils";

/**
 * The lenses, permanently in view.
 *
 * The product claim is one forecast read differently per person, and this is the
 * control that makes the claim falsifiable: the same page, the same numbers, with
 * the reading swapped by a tap. It sits in the header rather than behind Settings
 * because a control you have to go looking for cannot demonstrate anything.
 *
 * All eight focuses are listed, not only the selected ones. A row of just the
 * current selection can only ever *remove* a lens, which makes the header a
 * shrink control rather than a switch — and with one focus selected, the thing
 * that best demonstrates the product is unreachable from the page itself.
 *
 * Three states, deliberately distinct:
 *   - **unselected** — available, not chosen.
 *   - **selected** (filled) — "you chose this". Tapping removes it.
 *   - **lens** (accent ring) — "this is the reading you are looking at right
 *     now", the focus whose finding won the headline. It is an output of the
 *     engine rather than a setting, so it is marked and not toggled.
 *
 * The row scrolls horizontally rather than wrapping. Wrapping would grow the
 * header by a row per three chips and push the forecast down the page; a lens
 * row is a strip, like a tab bar.
 */
export function FocusChips({
  selected,
  active,
  onToggle,
  onEdit,
}: {
  selected: readonly FocusId[];
  /** The focus that produced the headline, if a focus reading won. */
  active: FocusId | null;
  onToggle: (id: FocusId) => void;
  onEdit: () => void;
}) {
  const chosen = new Set(selected);
  const row = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  /* Eight chips are wider than any phone, so the row scrolls — and a row that
     scrolls with nothing showing that it scrolls is a row with three focuses
     that do not exist as far as the reader can tell. Both edges are marked while
     there is more in that direction. */
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft >= max - 2);
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    measure();
    /* Observed rather than measured once: the strip also changes width when a
       label is added, and the edge markers must follow it. */
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, selected]);

  /* Selecting a chip that was off-screen must not leave the selection invisible.
     Adjusts the strip's own scrollLeft only — scrollIntoView would move the page
     too, and the lens row must never drag the forecast. */
  useEffect(() => {
    const el = row.current;
    const btn = active ? el?.querySelector<HTMLElement>(`[data-focus-chip="${active}"]`) : null;
    if (!el || !btn) return;
    const left = btn.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (left + btn.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = left + btn.offsetWidth - el.clientWidth;
    }
    measure();
  }, [active, measure]);

  return (
    <div className="relative px-5 pb-1" data-testid="focus-chips">
      {!atStart && (
        <div
          aria-hidden="true"
          data-testid="chips-fade-start"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[var(--wx-app-bg,#0a111c)] to-transparent"
        />
      )}
      {!atEnd && (
        <div
          aria-hidden="true"
          data-testid="chips-fade-end"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[var(--wx-app-bg,#0a111c)] to-transparent"
        />
      )}
      <div
        ref={row}
        data-testid="focus-chip-row"
        className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1.5"
        style={{ scrollbarWidth: "none" }}
        role="group"
        aria-label="What this forecast is read for"
      >
        {FOCUSES.map((f) => {
          const on = chosen.has(f.id);
          const isLens = active === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onToggle(f.id)}
              aria-pressed={on}
              aria-label={f.label}
              title={f.description}
              data-focus-chip={f.id}
              data-lens={isLens ? "true" : "false"}
              className={cn(
                "flex min-h-[30px] shrink-0 items-center rounded-full px-2.5 text-[11.5px] transition-colors",
                isLens
                  ? "bg-[var(--wx-accent)]/18 font-semibold text-[var(--wx-accent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--wx-accent)_60%,transparent)]"
                  : on
                    ? "bg-white/[0.09] font-medium text-[var(--ink-soft)] hover:bg-white/[0.14]"
                    : "text-[var(--ink-faint)] hover:bg-white/[0.06] hover:text-[var(--ink-soft)]",
              )}
            >
              {f.short}
            </button>
          );
        })}

        {selected.length === 0 && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 whitespace-nowrap px-1.5 text-[11px] text-[var(--ink-faint)] underline decoration-white/20 underline-offset-2 transition-colors hover:text-[var(--ink-soft)]"
          >
            Choose what matters
          </button>
        )}
      </div>
    </div>
  );
}

/* Re-exported so the attribution line and the lane heading cannot disagree with
   the chips about what a focus is called. */
export { FOCUS_BY_ID };
