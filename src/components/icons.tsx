import type { ReactNode } from "react";
import { CloudFog, CloudLightning, CloudRain, CloudSun, Moon, Sun } from "lucide-react";
import type { HourSample, WeatherState } from "../domain/weather";
import { cn } from "../lib/utils";

export function StateIcon({
  state,
  size = 20,
  className,
}: {
  state: WeatherState;
  size?: number;
  className?: string;
}) {
  const p = { size, className: cn(className), strokeWidth: 1.6 };
  switch (state) {
    case "sunny":
      return <Sun {...p} />;
    case "cloudy":
      return <CloudSun {...p} />;
    case "rain":
      return <CloudRain {...p} />;
    case "thunderstorm":
      return <CloudLightning {...p} />;
    case "fog":
      return <CloudFog {...p} />;
    case "night":
      return <Moon {...p} />;
  }
}

/** Compact glyph for the hourly strip, derived from the sample's own code. */
export function HourGlyph({ sample, size = 18 }: { sample: HourSample; size?: number }) {
  const p = { size, strokeWidth: 1.6 };
  if (sample.code === "thunder") return <CloudLightning {...p} />;
  if (sample.code === "fog") return <CloudFog {...p} />;
  if (sample.precipProb > 0.3 || sample.precipMm > 0.1) return <CloudRain {...p} />;
  if (!sample.isDay) return <Moon {...p} />;
  if (sample.code === "cloudy") return <CloudSun {...p} />;
  return <Sun {...p} />;
}

export function Row({
  icon,
  children,
  tone = "default",
}: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-snug">
      <span
        className={cn(
          "mt-[3px] shrink-0",
          tone === "accent" ? "text-[var(--wx-accent)]" : "text-[var(--ink-faint)]",
        )}
      >
        {icon}
      </span>
      <span className={tone === "accent" ? "text-white" : "text-[var(--ink-soft)]"}>
        {children}
      </span>
    </li>
  );
}
