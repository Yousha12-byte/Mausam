import { CloudOff, FlaskConical, History, Radio } from "lucide-react";
import { describeSource, type DataOrigin } from "../lib/source";
import { useWeather } from "../state/weather-store";
import { cn } from "../lib/utils";

const ICON: Record<DataOrigin, typeof Radio> = {
  live: Radio,
  cached: History,
  simulated: FlaskConical,
  demo: CloudOff,
};

/**
 * One quiet line saying where the numbers came from. Present because a sky
 * that looks live while showing simulated or replayed data is the one thing
 * this app must never do — so it states it rather than implying it.
 */
export function DataSourceNote() {
  const forecast = useWeather((s) => s.forecast);
  const origin = useWeather((s) => s.origin);
  const degradedReason = useWeather((s) => s.degradedReason);
  const nowEpoch = Date.now();

  const note = describeSource({ forecast, origin, degradedReason, nowEpoch });
  const Icon = ICON[note.origin];
  const flagged = note.origin === "simulated" || note.origin === "cached";

  return (
    <p
      data-source={note.origin}
      title={note.detail}
      className={cn(
        "flex items-center gap-1.5 text-[11.5px] leading-snug",
        flagged ? "text-[var(--ink-soft)]" : "text-[var(--ink-faint)]",
      )}
    >
      <Icon size={12} className="shrink-0" />
      <span className="truncate">{note.text}</span>
    </p>
  );
}
