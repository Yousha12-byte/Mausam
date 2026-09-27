import type { GeoLocation, NormalizedForecast } from "../domain/weather";
import type { WeatherProvider } from "./provider";
import {
  buildScenarioForecast,
  scenarioDayTimes,
  SCENARIOS,
  type ScenarioSpec,
} from "./scenarios";

/** India Standard Time. */
export const IST_OFFSET_MIN = 330;

let active: ScenarioSpec = SCENARIOS[0]!;

export function setActiveScenario(id: string): void {
  active = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}

export function activeScenario(): ScenarioSpec {
  return active;
}

/**
 * Deterministic offline provider. Every SIH scenario is reproducible, so the
 * demo never depends on what the weather is actually doing outside.
 */
export const mockProvider: WeatherProvider = {
  id: "mock",
  label: "Simulated",
  live: false,
  async getForecast(location: GeoLocation, at: number): Promise<NormalizedForecast> {
    const timezone = location.timezone ?? "Asia/Kolkata";
    const tzOffsetMin = getTzOffsetMin(timezone, at);
    const hourly = buildScenarioForecast(active, location.lat, tzOffsetMin, at);
    const { sunriseMin, sunsetMin } = scenarioDayTimes(location.lat, location.lon, at);
    return {
      location: { ...location, timezone: location.timezone ?? "Asia/Kolkata" },
      tzOffsetMin,
      timezone: location.timezone ?? "Asia/Kolkata",
      fetchedAt: at,
      source: "mock",
      // Generated data is never an observation, so it must never be presented
      // as one. The now-sample is read off the hourly grid instead.
      current: null,
      hourly,
      sunriseMin,
      sunsetMin,
    };
  },
};

/**
 * Get timezone offset in minutes for a given IANA timezone at a specific time.
 * Uses Intl API for accurate DST handling.
 */
function getTzOffsetMin(timezone: string, at: number): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(new Date(at));
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    if (offsetPart) {
      const match = offsetPart.value.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
      if (match && match[1] && match[2]) {
        const sign = match[1] === "+" ? 1 : -1;
        const hours = Number.parseInt(match[2], 10);
        const minutes = match[3] ? Number.parseInt(match[3], 10) : 0;
        return sign * (hours * 60 + minutes);
      }
    }
  } catch {
    // fall through
  }
  return IST_OFFSET_MIN;
}
