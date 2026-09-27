import type { ReactNode } from "react";
import { Clock3, Volume2, VolumeX, Wind } from "lucide-react";
import { ScenarioSwitcher } from "./ScenarioSwitcher";
import { SectionLabel, Sheet } from "./ui";
import { FocusPicker } from "./FocusPicker";
import { useFocus } from "../state/focus-store";
import { useAirQuality } from "../state/airquality-store";
import { useSettings } from "../state/settings-store";
import { useWeather } from "../state/weather-store";
import { cn, formatClock } from "../lib/utils";

/** A labelled on/off row. Sized to the same touch floor as the rest of the app. */
function Toggle({
  icon,
  label,
  hint,
  on,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-colors hover:bg-white/8"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-[var(--ink-soft)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-tight">{label}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-[var(--ink-faint)]">
          {hint}
        </span>
      </span>
      <span
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors",
          on ? "bg-[var(--wx-accent)]" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            on ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

/**
 * Everything the app can be configured with, in one place.
 *
 * The presentation controls used to sit in the page footer, which made the
 * homepage read as a demo harness: three labels describing internal state
 * ("Demo scenarios", "Clock pinned", "Reduce motion") sat above the fold of a
 * screen most people only ever glance at. They are consumer settings, so they
 * live behind a settings affordance now, and the homepage is left with the
 * forecast alone.
 */
function airLabel(status: string): string {
  switch (status) {
    case "ready":
      return "Available";
    case "unavailable":
      return "Unavailable";
    case "loading":
      return "Checking";
    default:
      return "Not requested";
  }
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sound = useSettings((s) => s.sound);
  const toggleSound = useSettings((s) => s.toggleSound);
  const motion = useSettings((s) => s.motion);
  const toggleMotion = useSettings((s) => s.toggleMotion);

  const clockOverride = useWeather((s) => s.clockOverride);
  const setClock = useWeather((s) => s.setClock);

  const selectedFocus = useFocus((s) => s.selected);
  const toggleFocus = useFocus((s) => s.toggle);
  const air = useAirQuality((s) => s.air);

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="mb-6 space-y-1">
        <Toggle
          icon={sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          label="Ambience"
          hint="Rain and wind sounds while Mausam is open."
          on={sound}
          onToggle={toggleSound}
        />
        <Toggle
          icon={<Wind size={16} />}
          label="Animate the sky"
          hint="Turn off to hold the weather still and save battery."
          on={motion}
          onToggle={toggleMotion}
        />
        {clockOverride !== null && (
          <button
            onClick={() => setClock(null)}
            className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-colors hover:bg-white/8"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-[var(--ink-soft)]">
              <Clock3 size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-tight">Use real time</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-[var(--ink-faint)]">
                Currently showing {formatClock(clockOverride)}.
              </span>
            </span>
          </button>
        )}
      </div>

      {/* Focus lives beside Presentation Mode rather than inside it. One is a
          question about the weather, the other is a question about the person
          reading it, and mixing them is what made the old footer read like a
          demo harness rather than a settings page. */}
      <SectionLabel>My focus</SectionLabel>
      <p className="mb-3 text-[13px] leading-relaxed text-[var(--ink-soft)]">
        Choose as many as you like. MAUSAM reads the same forecast differently for each one, and
        shows the measurements that focus actually uses.
      </p>
      <FocusPicker selected={selectedFocus} onToggle={toggleFocus} idPrefix="settings" />

      <div className="mt-4 rounded-[16px] border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-[var(--ink-soft)]">Air quality</span>
          <span
            data-testid="aqi-status"
            data-status={air.status}
            className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10.5px] text-[var(--ink-soft)]"
          >
            {airLabel(air.status)}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--ink-faint)]">
          {air.status === "ready"
            ? "Live reading from a separate air-quality source."
            : air.status === "unavailable"
              ? "Unavailable right now. Weather is unaffected — this is a separate source."
              : air.status === "loading"
                ? "Checking…"
                : "Not requested yet."}
        </p>
      </div>

      <SectionLabel>Presentation Mode</SectionLabel>
      <p className="mb-4 text-[13px] leading-relaxed text-[var(--ink-soft)]">
        Live Weather uses your saved place. The scenarios below are fixed skies over Kochi, for
        demos and projectors where the live sky and the wifi are both unreliable. Choosing one
        never changes your saved location.
      </p>
      <ScenarioSwitcher />
    </Sheet>
  );
}
