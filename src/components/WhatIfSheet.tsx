import { useMemo, useState } from "react";
import { Check, Sparkles, TriangleAlert, X } from "lucide-react";
import { useProfile } from "../state/profile-store";
import { useWeather } from "../state/weather-store";
import { formatClock } from "../lib/utils";
import { Sheet, SectionLabel } from "./ui";
import { peakIn } from "../domain/decision";
import { findEvent, scopeProfile } from "../domain/routine";
import { useFocus } from "../state/focus-store";

/** Candidate departures: 45 min either side of the configured window, in 5 min steps. */
const SPREAD_MIN = 45;
const STEP_MIN = 5;

const sevColor = (s: number) =>
  s >= 0.6 ? "var(--sev-avoid)" : s >= 0.45 ? "var(--sev-caution)" : "var(--sev-calm)";

/**
 * "8:15 → affected / 8:40 → clear", literally.
 *
 * The old version showed one slider and one verdict, so comparing options meant
 * remembering what the last one said. This scores every candidate and draws the
 * whole window as a row of bars, so the best departure is visible before you
 * touch anything, and moving the slider moves a marker through a landscape you
 * can already read.
 */
export function WhatIfSheet({
  open,
  onClose,
  eventId,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
}) {
  const profile = useProfile((s) => s.profile);
  const forecast = useWeather((s) => s.forecast);
  const whatIf = useWeather((s) => s.whatIf);
  const setWhatIf = useWeather((s) => s.setWhatIf);
  const clearWhatIf = useWeather((s) => s.clearWhatIf);

  const event = findEvent(profile, eventId);
  const selectedFocus = useFocus((s) => s.selected);
  const engineProfile = scopeProfile(profile, selectedFocus);
  const [picked, setPicked] = useState<number | null>(null);

  const options = useMemo(() => {
    if (!forecast || !event) return [];
    const out: Array<{ startMin: number; severity: number; atMin: number }> = [];
    for (
      let t = event.startMin - SPREAD_MIN;
      t <= event.startMin + SPREAD_MIN;
      t += STEP_MIN
    ) {
      const { severity, atMin } = peakIn(forecast, engineProfile, t, event.travelMin, event.mode);
      out.push({ startMin: t, severity, atMin });
    }
    return out;
  }, [forecast, event, engineProfile]);

  if (!event || !options.length) return null;

  const best = options.reduce((a, b) => (b.severity < a.severity ? b : a));
  const worst = options.reduce((a, b) => (b.severity > a.severity ? b : a));
  const routine = options.find((o) => o.startMin === event.startMin);
  const routineSeverity = routine?.severity ?? 0;
  const active = whatIf?.eventId === event.id ? whatIf.startMin : picked ?? event.startMin;
  const preview = options.find((o) => o.startMin === active) ?? best;
  const saved = Math.max(0, Math.round((routineSeverity - preview.severity) * 100));
  const affected = preview.severity >= 0.45;
  const maxSev = Math.max(0.3, ...options.map((o) => o.severity));

  function apply() {
    setWhatIf(event!.id, active);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="What if you left earlier?">
      {!forecast ? (
        <p className="text-[13px] text-[var(--ink-soft)]">Waiting for a forecast…</p>
      ) : (
        <>
          <p className="text-[14px] leading-relaxed text-[var(--ink-soft)]">
            You usually leave for <strong className="text-white">{event.label}</strong> at{" "}
            <strong className="text-white">{formatClock(event.startMin)}</strong>. Mausam re-ran
            your whole journey against each of these.
          </p>

          {/* The comparison, drawn rather than described. */}
          <div className="mt-5">
            <SectionLabel>Every departure in this window</SectionLabel>
            <div className="flex h-[86px] items-end gap-[3px]" role="img" aria-label="Severity of your journey at each candidate departure time">
              {options.map((o) => {
                const on = o.startMin === active;
                const h = 14 + (o.severity / maxSev) * 56;
                return (
                  <button
                    key={o.startMin}
                    onClick={() => setPicked(o.startMin)}
                    aria-label={`${formatClock(o.startMin)}, ${
                      o.severity >= 0.45 ? "affected" : "clear"
                    }`}
                    aria-pressed={on}
                    className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                  >
                    <span
                      className="w-full rounded-t-[3px] transition-all duration-300"
                      style={{
                        height: h,
                        background: sevColor(o.severity),
                        opacity: on ? 1 : o.severity >= 0.45 ? 0.5 : 0.32,
                        outline: on ? "1.5px solid rgb(255 255 255 / 0.85)" : "none",
                        outlineOffset: 1,
                      }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[10.5px] tabular-nums text-[var(--ink-faint)]">
              <span>{formatClock(options[0]!.startMin)}</span>
              <span>{formatClock(event.startMin)}</span>
              <span>{formatClock(options[options.length - 1]!.startMin)}</span>
            </div>
          </div>

          <input
            type="range"
            min={event.startMin - SPREAD_MIN}
            max={event.startMin + SPREAD_MIN}
            step={STEP_MIN}
            value={active}
            onChange={(ev) => setPicked(Number(ev.target.value))}
            aria-label="Departure time"
            className="mt-4 w-full accent-[var(--wx-accent)]"
          />

          {/* The result, stated in one comparison. */}
          <div className="mt-4 rounded-[18px] bg-white/[0.07] p-4 shadow-[inset_0_0_0_1px_var(--line-soft)]">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-medium tabular-nums">
                {formatClock(event.startMin)}{" "}
                <span className="text-[var(--ink-faint)]">→</span>{" "}
                <strong className="text-[17px]">{formatClock(active)}</strong>
              </p>
              {saved > 0 && (
                <span className="shrink-0 text-[12px] font-semibold text-[var(--sev-calm)]">
                  −{saved}% severity
                </span>
              )}
            </div>
            <p
              className="mt-2 flex items-center gap-1.5 text-[15px] font-semibold"
              style={{ color: affected ? "var(--sev-caution)" : "var(--sev-calm)" }}
            >
              {affected ? (
                <TriangleAlert size={15} className="shrink-0" />
              ) : (
                <Check size={15} className="shrink-0" />
              )}
              {affected ? "affected" : "clear"}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-snug text-[var(--ink-faint)]">
              Hardest moment {formatClock(preview.atMin)} ·{" "}
              {affected
                ? `about ${Math.round(preview.severity * 100)}% of your usual sensitivity`
                : "comfortably below your sensitivity threshold"}
            </p>
          </div>

          {best.startMin !== event.startMin && (
            <button
              onClick={() => setPicked(best.startMin)}
              className="mt-3 flex w-full items-center gap-2.5 rounded-[18px] bg-[var(--wx-accent)]/14 px-4 py-3 text-left shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--wx-accent)_40%,transparent)] transition-colors hover:bg-[var(--wx-accent)]/22"
            >
              <Sparkles size={16} className="shrink-0 text-[var(--wx-accent)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">Leave at {formatClock(best.startMin)}</p>
                <p className="text-[12px] text-[var(--ink-soft)]">
                  {worst.severity > best.severity
                    ? `${Math.round((worst.severity - best.severity) * 100)} points calmer than your worst option`
                    : `calmer than ${formatClock(event.startMin)}`}
                </p>
              </div>
            </button>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => {
                clearWhatIf();
                onClose();
              }}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[16px] py-2.5 text-[13.5px] text-[var(--ink-soft)] hover:bg-white/8"
            >
              <X size={14} />
              Keep {formatClock(event.startMin)}
            </button>
            <button
              onClick={apply}
              disabled={active === event.startMin}
              className="min-h-[44px] flex-1 rounded-[16px] py-2.5 text-[13.5px] font-semibold text-[#08121d] disabled:opacity-40"
              style={{ background: "var(--wx-accent)" }}
            >
              Use {formatClock(active)}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
