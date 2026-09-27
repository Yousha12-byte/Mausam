import type { NormalizedForecast } from "../domain/weather";
import { formatClock } from "./utils";

/**
 * What the numbers on screen actually are. The app can hold simulated or
 * replayed data at any moment, and a sky that looks live while showing
 * yesterday's cached forecast is the one failure this project cannot make.
 */
export type DataOrigin = "live" | "cached" | "simulated" | "demo";

export interface SourceNote {
  origin: DataOrigin;
  /** Compact, single line, e.g. "Open-Meteo · Updated 5:40 PM". */
  text: string;
  /** Longer form for the title attribute and for tests. */
  detail: string;
}

/** "just now" / "12 min ago" / "3 hours ago". */
export function agoLabel(fromEpoch: number, nowEpoch: number): string {
  const min = Math.max(0, Math.round((nowEpoch - fromEpoch) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h === 1 ? "1 hour ago" : `${h} hours ago`;
}

/** The clock time at the location, which is the only time the user cares about. */
function localStamp(f: NormalizedForecast, epoch: number): string {
  const shifted = new Date(epoch + f.tzOffsetMin * 60_000);
  return formatClock(shifted.getUTCHours() * 60 + shifted.getUTCMinutes());
}

export function describeSource(args: {
  forecast: NormalizedForecast | null;
  origin: DataOrigin;
  degradedReason?: string;
  nowEpoch: number;
}): SourceNote {
  const { forecast, origin, degradedReason, nowEpoch } = args;
  if (!forecast) {
    return { origin: "simulated", text: "Reading the sky…", detail: "No forecast loaded yet." };
  }

  const place = forecast.location.name;
  const at = localStamp(forecast, forecast.fetchedAt);
  const age = agoLabel(forecast.fetchedAt, nowEpoch);

  if (origin === "demo") {
    return {
      origin: "demo",
      text: `Demo weather · ${place}`,
      detail: `Simulated scenario pinned to ${place}. Your saved location is not affected.`,
    };
  }

  if (origin === "simulated") {
    return {
      origin: "simulated",
      text: "Simulated weather · live unavailable",
      detail: `Live weather could not be reached, so this is generated data, not an observation.${degradedReason ? ` (${degradedReason})` : ""}`,
    };
  }

  if (origin === "cached") {
    return {
      origin: "cached",
      text: `Cached forecast · ${age}`,
      detail: `Live weather is unreachable. Showing the last forecast saved for ${place} at ${at}.`,
    };
  }

  return {
    origin: "live",
    text: `Open-Meteo · Updated ${at}`,
    detail: `Live observation and forecast for ${place}, retrieved at ${at} (${age}).`,
  };
}
