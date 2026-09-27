import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { FocusPicker } from "./FocusPicker";
import { useFocus } from "../state/focus-store";
import type { FocusId } from "../domain/focus";

/**
 * First-run focus prompt. One screen, one question, one way out.
 *
 * It is deliberately not a wizard. The first thing this app does is show
 * weather, and anything that stands between the user and that weather is a
 * cost paid for a benefit they have not yet agreed to. So: a single step, no
 * sign-up, no permissions — in particular it never asks for location, because
 * a weather app that opens by demanding the sensor it needs is trading a
 * stranger's goodwill for a permission it will need anyway.
 *
 * Skipping is a first-class path, not a dismissal. It installs the same default
 * focus the app would have used, marks the prompt done so it never reappears,
 * and leaves a Settings row to revisit the choice.
 */
export function Onboarding() {
  const onboarded = useFocus((s) => s.onboarded);
  const completeOnboarding = useFocus((s) => s.completeOnboarding);
  const skipOnboarding = useFocus((s) => s.skipOnboarding);
  const [draft, setDraft] = useState<FocusId[]>([]);

  /* Escape and a backdrop tap both take the skip path, not a dismissal that
     leaves the prompt to reappear. A prompt that is described as optional and
     then ignores the universal "dismiss" gesture is not optional. */
  useEffect(() => {
    if (onboarded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && skipOnboarding();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onboarded, skipOnboarding]);

  if (onboarded) return null;

  const toggle = (id: FocusId) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <div className="wx-sheet-root fixed inset-0 z-50 flex items-end justify-center">
      {/* Tapping the scrim skips, matching the "Skip for now" button exactly. */}
      <button
        aria-label="Skip for now"
        onClick={skipOnboarding}
        className="absolute inset-0 bg-black/55"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Make MAUSAM yours"
        data-testid="onboarding"
        className="wx-sheet-panel relative z-10 max-h-[92dvh] w-full max-w-[430px] overflow-y-auto rounded-t-[28px] bg-[#0a111c] p-5 pb-6 shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.8)]"
        style={{ boxShadow: "inset 0 1px 0 0 rgb(255 255 255 / 0.09)" }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--ink-faint)]">
          Make MAUSAM yours
        </p>
        <h2 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight">
          What matters to you?
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
          Pick as many as you like. MAUSAM reinterprets the same forecast for each one.
        </p>

        <div className="mt-4">
          <FocusPicker selected={draft} onToggle={toggle} idPrefix="onboard" />
        </div>

        <button
          type="button"
          onClick={() => completeOnboarding(draft)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-[16px] bg-[var(--wx-accent)] py-3.5 text-[15px] font-semibold text-black transition-opacity active:opacity-80"
        >
          {draft.length > 0 ? "Continue" : "Continue with Daily Life"}
          <ArrowRight size={17} />
        </button>

        <button
          type="button"
          onClick={skipOnboarding}
          className="mt-2 w-full py-2.5 text-[13px] text-[var(--ink-faint)] transition-colors hover:text-[var(--ink-soft)]"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
