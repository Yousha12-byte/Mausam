import type { HourSample } from "./weather";

/* ============================================================ CAPABILITIES ==

   What the app can actually measure, and where each measurement comes from.

   This exists so that a focus can ask for humidity without anyone having to
   decide in the UI whether humidity is real. The capability table is the single
   place that answers "can we show this?", and the rule it enforces is that a
   metric either has a provider behind it or it is absent from the interface
   entirely. There is deliberately no third option: no metric is ever rendered
   from a default, a guess, or a plausible-looking placeholder. */

export type MetricId =
  | "temperature"
  | "apparentTemperature"
  | "precipitation"
  | "precipProbability"
  | "humidity"
  | "wind"
  | "gusts"
  | "visibility"
  | "uv"
  | "thunder"
  | "precipAccumulation"
  | "soilMoisture"
  | "aqi";

/** Where a measurement originates. This is what keeps AQI honest. */
export type MetricSource =
  /** Delivered by the main weather forecast request. */
  | "weather"
  /** A separate, independently-failing capability that runs in parallel. */
  | "air-quality"
  /** Not obtainable from any configured source. */
  | "unavailable";

export interface Capability {
  id: MetricId;
  label: string;
  source: MetricSource;
  /**
   * True when the figure is a measurement of the real world, false when it is a
   * model's estimate. Soil moisture is honest about being the latter: it is a
   * coarse numerical-model field, not a reading from the user's field.
   */
  measured: boolean;
  /** Short note shown wherever the metric is surfaced. */
  caveat?: string;
}

/**
 * The measured surface of the app.
 *
 * Weather metrics come from the Open-Meteo forecast request the app already
 * makes. AQI is listed separately because it is a distinct endpoint on a
 * distinct host with its own failure mode — a request that can fail while the
 * weather is perfectly fine, and which must therefore never be allowed to take
 * the homepage down with it.
 */
export const CAPABILITIES: Record<MetricId, Capability> = {
  temperature: { id: "temperature", label: "Temperature", source: "weather", measured: true },
  apparentTemperature: {
    id: "apparentTemperature",
    label: "Feels like",
    source: "weather",
    measured: true,
  },
  precipitation: { id: "precipitation", label: "Rainfall", source: "weather", measured: true },
  precipProbability: {
    id: "precipProbability",
    label: "Rain chance",
    source: "weather",
    measured: false,
  },
  humidity: { id: "humidity", label: "Humidity", source: "weather", measured: true },
  wind: { id: "wind", label: "Wind", source: "weather", measured: true },
  gusts: { id: "gusts", label: "Gusts", source: "weather", measured: true },
  visibility: { id: "visibility", label: "Visibility", source: "weather", measured: true },
  uv: { id: "uv", label: "UV index", source: "weather", measured: true },
  thunder: { id: "thunder", label: "Thunderstorm risk", source: "weather", measured: true },
  precipAccumulation: {
    id: "precipAccumulation",
    label: "Rainfall total",
    source: "weather",
    measured: false,
    caveat: "Summed from the hourly forecast",
  },
  soilMoisture: {
    id: "soilMoisture",
    label: "Soil moisture",
    source: "weather",
    measured: false,
    caveat: "Numerical model estimate, not a field reading",
  },
  aqi: {
    id: "aqi",
    label: "Air quality",
    source: "air-quality",
    measured: true,
    caveat: "Separate air-quality source; may be unavailable while weather is fine",
  },
};

export function capabilityOf(id: MetricId): Capability {
  return CAPABILITIES[id];
}

/** True when the app has a real source behind this metric. */
export function isSupported(id: MetricId): boolean {
  return CAPABILITIES[id].source !== "unavailable";
}

/** Metrics that ride along on the weather request and are always co-available. */
export function isWeatherBacked(id: MetricId): boolean {
  return CAPABILITIES[id].source === "weather";
}

/** Metrics that need the parallel air-quality capability. */
export function isAirQualityBacked(id: MetricId): boolean {
  return CAPABILITIES[id].source === "air-quality";
}

/* ------------------------------------------------------------ FORMATTING --- */

/** A missing value renders as an explicit absence, never as a zero. */
export const UNAVAILABLE = "Unavailable" as const;

export function formatHumidity(s: HourSample): string | null {
  if (typeof s.humidityPct !== "number" || !Number.isFinite(s.humidityPct)) return null;
  return `${Math.round(s.humidityPct)}%`;
}

export function formatSoilMoisture(s: HourSample): string | null {
  if (typeof s.soilMoisture !== "number" || !Number.isFinite(s.soilMoisture)) return null;
  return `${(s.soilMoisture * 100).toFixed(0)}%`;
}

export function formatUv(s: HourSample): string | null {
  if (typeof s.uvIndex !== "number" || !Number.isFinite(s.uvIndex)) return null;
  return String(Math.round(s.uvIndex));
}

/** US AQI bands, named rather than numbered so the sentence stays readable. */
export function describeAqi(usAqi: number): { label: string; tone: "good" | "moderate" | "unhealthy" } {
  if (usAqi <= 50) return { label: "Good", tone: "good" };
  if (usAqi <= 100) return { label: "Moderate", tone: "moderate" };
  if (usAqi <= 150) return { label: "Unhealthy for sensitive groups", tone: "unhealthy" };
  if (usAqi <= 200) return { label: "Unhealthy", tone: "unhealthy" };
  return { label: "Very unhealthy", tone: "unhealthy" };
}
