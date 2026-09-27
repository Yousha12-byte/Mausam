import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FOCUSES, type FocusId } from "../domain/focus";
import { CONTEXT_COPY, windowSeed } from "../domain/focus-context";
import { MODE_EXPOSURE, type RoutineEvent } from "../domain/routine";
import { useProfile } from "../state/profile-store";
import { useFocus } from "../state/focus-store";
import { formatClock } from "../lib/utils";
import { Sheet, SectionLabel } from "./ui";

function toInput(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function fromInput(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * The context sheet.
 *
 * It edits the schedule of *one* focus at a time, and the focus being edited is
 * the one selected in the header — so choosing Agriculture here shows field
 * windows, and choosing Commute shows journeys. The switcher is there because
 * more than one focus can be selected, and silently editing whichever sorted
 * first would be the same mistake in a new place.
 *
 * A focus with nothing configured is not given controls it has no use for. Daily
 * Life in particular gets an empty state and an explicit opt-in rather than time
 * inputs, because a "daily schedule" is not a thing.
 */
export function ProfileSheet({
  open,
  onClose,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** Which focus to open on; defaults to the first selected one. */
  initialFocus?: FocusId | null;
}) {
  const profile = useProfile((s) => s.profile);
  const setWindowTime = useProfile((s) => s.setWindowTime);
  const setLabel = useProfile((s) => s.setLabel);
  const setVariance = useProfile((s) => s.setVariance);
  const addWindow = useProfile((s) => s.addWindow);
  const removeWindow = useProfile((s) => s.removeWindow);
  const reset = useProfile((s) => s.reset);
  const selected = useFocus((s) => s.selected);
  /* The focus being edited follows whoever opened the sheet. The component stays
     mounted while closed, so this cannot be seeded once at mount: opening the
     sheet for Agriculture after Daily Life had been edited would otherwise carry
     on showing the day's context, which is the same class of mistake as the one
     this sheet exists to fix. */
  const [editing, setEditing] = useState<FocusId | null>(null);
  useEffect(() => {
    if (open) setEditing(initialFocus ?? null);
  }, [open, initialFocus]);

  /* Only the selected focuses are offered. Editing a schedule for a focus that
     is not selected would configure context the page never reads — the exact
     silent-failure this rebuild exists to remove. */
  const editable = FOCUSES.filter((f) => selected.includes(f.id)).map((f) => f.id);
  const focusId = (editing && editable.includes(editing) ? editing : null) ?? editable[0] ?? "commute";
  const copy = CONTEXT_COPY[focusId];
  const events: RoutineEvent[] = profile.schedules[focusId]?.events ?? [];

  return (
    <Sheet open={open} onClose={onClose} title={copy.title} data-testid="context-sheet">
      <p
        className="mb-4 text-[13px] leading-relaxed text-[var(--ink-soft)]"
        data-testid="context-blurb"
      >
        {copy.blurb}
      </p>

      {editable.length > 1 && (
        <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Which focus to configure">
          {editable.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setEditing(id)}
              aria-pressed={id === focusId}
              data-testid={`context-tab-${id}`}
              className={
                id === focusId
                  ? "shrink-0 rounded-full bg-[var(--wx-accent)]/18 px-2.5 py-1 text-[11.5px] font-semibold text-[var(--wx-accent)]"
                  : "shrink-0 rounded-full px-2.5 py-1 text-[11.5px] text-[var(--ink-faint)] hover:bg-white/8"
              }
            >
              {FOCUSES.find((f) => f.id === id)?.short ?? id}
            </button>
          ))}
        </div>
      )}

      <SectionLabel>{copy.windowNoun}{events.length > 1 ? "s" : ""}</SectionLabel>

      {events.length === 0 ? (
        <div
          className="rounded-[18px] bg-white/[0.06] p-4 shadow-[inset_0_0_0_1px_var(--line-soft)]"
          data-testid="context-empty"
        >
          <p className="text-[12.5px] leading-relaxed text-[var(--ink-soft)]">{copy.empty}</p>
        </div>
      ) : (
        <div className="space-y-2.5" data-testid="context-windows">
          {events.map((e) => (
            <div
              key={e.id}
              data-testid="context-window"
              className="border-b border-[var(--line-soft)] py-3.5 first:pt-0 last:border-0"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    value={e.label}
                    aria-label={`Label for ${copy.windowNoun.toLowerCase()}`}
                    onChange={(ev) => setLabel(e.id, ev.target.value)}
                    className="w-full truncate rounded-lg bg-transparent text-[15px] font-medium outline-none focus-visible:underline"
                  />
                  <p className="mt-0.5 text-[11px] text-[var(--ink-faint)]">
                    {formatClock(e.startMin)}–{formatClock(e.startMin + e.durationMin)} ·{" "}
                    {e.travelMin} min outdoors · {Math.round(MODE_EXPOSURE[e.mode] * 100)}% exposed
                  </p>
                </div>
                <input
                  type="time"
                  value={toInput(e.startMin)}
                  aria-label={`Start time for ${e.label}`}
                  onChange={(ev) => setWindowTime(focusId, e.id, fromInput(ev.target.value))}
                  className="min-h-[40px] shrink-0 rounded-[12px] bg-black/35 px-3 py-2 text-[15px] tabular-nums [color-scheme:dark] shadow-[inset_0_0_0_1px_var(--line)]"
                />
                <button
                  type="button"
                  onClick={() => removeWindow(e.id)}
                  aria-label={`Remove ${e.label}`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--ink-faint)] hover:bg-white/10 hover:text-white"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => addWindow(focusId, windowSeed(focusId))}
        data-testid="context-add"
        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[16px] bg-white/[0.06] py-2.5 text-[13.5px] text-[var(--ink-soft)] hover:bg-white/10"
      >
        <Plus size={15} />
        {copy.addLabel}
      </button>

      {/* Departure uncertainty is only meaningful where there is a departure.
          Offering it for a field window would ask a question about a window the
          user is already inside. */}
      {copy.hasDeparture && (
        <div className="mt-5">
          <SectionLabel>How steady are your departure times?</SectionLabel>
          <div className="rounded-[18px] bg-white/[0.06] p-4 shadow-[inset_0_0_0_1px_var(--line-soft)]">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-[var(--ink-soft)]">Usually within</span>
              <span className="text-[15px] font-semibold tabular-nums">± {profile.varianceMin} min</span>
            </div>
            <input
              type="range"
              min={0}
              max={60}
              step={5}
              value={profile.varianceMin}
              aria-label="Departure time variance in minutes"
              onChange={(ev) => setVariance(Number(ev.target.value))}
              className="mt-2.5 w-full accent-[var(--wx-accent)]"
            />
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--ink-faint)]">
              A wider spread lowers recommendation confidence — Mausam tells you
              when it is less sure rather than pretending otherwise.
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 rounded-[18px] bg-white/[0.06] p-4 shadow-[inset_0_0_0_1px_var(--line-soft)]">
        <p className="text-[12px] font-semibold text-[var(--ink-soft)]">How you experience weather</p>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {(Object.keys(profile.sensitivity) as Array<keyof typeof profile.sensitivity>).map((k) => (
            <div key={k} className="text-center">
              <div className="mx-auto h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-[var(--wx-accent)]"
                  style={{ width: `${profile.sensitivity[k] * 100}%` }}
                />
              </div>
              <p className="mt-1 text-[9px] capitalize text-[var(--ink-faint)]">{k === "lowVis" ? "vis" : k}</p>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={reset}
        className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[16px] py-2.5 text-[13.5px] text-[var(--ink-soft)] hover:bg-white/8"
      >
        <RotateCcw size={14} />
        Reset to the demo profile
      </button>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-[var(--ink-faint)]" data-testid="context-summary">
        {editable.length === 0
          ? "No focus selected, so there is no context to configure."
          : events.length === 0
            ? `Nothing configured for ${copy.title.replace(/^Your /, "").toLowerCase()} yet.`
            : events.map((e) => `${e.label} at ${formatClock(e.startMin)}`).join(" · ")}
      </p>
    </Sheet>
  );
}
