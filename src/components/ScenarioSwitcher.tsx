import { CloudFog, CloudLightning, CloudRain, CloudSun, Moon, Sun, SunMedium } from "lucide-react";
import { SCENARIOS } from "../data";
import { useWeather } from "../state/weather-store";
import { cn } from "../lib/utils";

const ICON: Record<string, typeof Sun> = {
  sunny: Sun,
  cloudy: CloudSun,
  rain: CloudRain,
  thunderstorm: CloudLightning,
  fog: CloudFog,
  night: Moon,
};

/**
 * Presentation Mode. Exactly two settings — a named demo scenario, or live
 * weather — chosen from an explicit grid.
 *
 * There is no "simulated" control. The previous version had a single main
 * button that toggled a `preferLive` flag, which meant one tap could put the
 * app on generated numbers while the header still named the real city, and the
 * button's own label flipped between "Live weather" and "Simulated". If live
 * data is unreachable the source note says so on its own; it is not a mode the
 * user should be able to select.
 */
export function ScenarioSwitcher() {
  const scenarioId = useWeather((s) => s.scenarioId);
  const setScenario = useWeather((s) => s.setScenario);
  const active = SCENARIOS.find((s) => s.id === scenarioId);
  const isDemo = scenarioId !== null;
  const StatusIcon = isDemo ? (ICON[scenarioId!] ?? Sun) : SunMedium;

  return (
    <div>
      <p className="-ml-1.5 flex min-h-[36px] items-center gap-1.5 px-1.5 text-[12.5px] text-[var(--ink-faint)]">
        <StatusIcon size={12} aria-hidden />
        {isDemo ? `Demo: ${active?.label ?? "Scenario"}` : "Live weather"}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {/* Live weather option */}
        <button
          onClick={() => void setScenario(null)}
          aria-pressed={scenarioId === null}
          className={cn(
            "flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-[14px] px-1 py-2.5 transition-colors",
            scenarioId === null
              ? "bg-[var(--wx-accent)]/18 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--wx-accent)_55%,transparent)]"
              : "hover:bg-white/10",
          )}
        >
          <SunMedium
            size={18}
            className={scenarioId === null ? "text-[var(--wx-accent)]" : "text-[var(--ink-soft)]"}
          />
          <span
            className={cn(
              "text-[11px] leading-tight",
              scenarioId === null ? "font-semibold text-white" : "text-[var(--ink-soft)]",
            )}
          >
            Live
          </span>
        </button>

        {/* Demo scenarios */}
        {SCENARIOS.map((s) => {
          const Icon = ICON[s.id] ?? Sun;
          const on = scenarioId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => void setScenario(s.id)}
              aria-pressed={on}
              className={cn(
                "flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-[14px] px-1 py-2.5 transition-colors",
                on
                  ? "bg-[var(--wx-accent)]/18 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--wx-accent)_55%,transparent)]"
                  : "hover:bg-white/10",
              )}
            >
              <Icon
                size={18}
                className={on ? "text-[var(--wx-accent)]" : "text-[var(--ink-soft)]"}
              />
              <span
                className={cn(
                  "text-[11px] leading-tight",
                  on ? "font-semibold text-white" : "text-[var(--ink-soft)]",
                )}
              >
                {s.label}
              </span>
            </button>
          );
        })}
      </div>

      {active && (
        <p className="mt-2.5 text-[12px] leading-snug text-[var(--ink-faint)]">{active.blurb}</p>
      )}
    </div>
  );
}