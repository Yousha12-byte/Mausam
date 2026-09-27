import type { ExposureVector, HourSample, WeatherState, WxCode } from "./weather";

/* ------------------------------------------------- PROVIDER CODE → WxCode */

interface CodeBand {
  max: number;
  code: WxCode;
}

/** WMO 4677 weather interpretation codes, as used by Open-Meteo. */
const WMO: CodeBand[] = [
  { max: 0, code: "clear" },
  { max: 1, code: "clear" },
  { max: 2, code: "partly" },
  { max: 3, code: "cloudy" },
  { max: 45, code: "fog" },
  { max: 48, code: "fog" },
  { max: 51, code: "drizzle" },
  { max: 53, code: "drizzle" },
  { max: 55, code: "drizzle" },
  { max: 56, code: "drizzle" },
  { max: 57, code: "drizzle" },
  { max: 61, code: "rain" },
  { max: 63, code: "rain" },
  { max: 65, code: "heavy_rain" },
  { max: 66, code: "rain" },
  { max: 67, code: "heavy_rain" },
  { max: 71, code: "rain" },
  { max: 73, code: "rain" },
  { max: 75, code: "rain" },
  { max: 77, code: "rain" },
  { max: 80, code: "rain" },
  { max: 81, code: "heavy_rain" },
  { max: 82, code: "heavy_rain" },
  { max: 85, code: "rain" },
  { max: 95, code: "thunder" },
  { max: 96, code: "thunder" },
  { max: 99, code: "thunder" },
];

export function fromWmoCode(code: number): WxCode {
  for (const band of WMO) if (code <= band.max) return band.code;
  return "clear";
}

/* ------------------------------------------------------------ TAXONOMY */

export const CODE_LABEL: Record<WxCode, string> = {
  clear: "Clear",
  partly: "Partly cloudy",
  cloudy: "Overcast",
  fog: "Fog",
  drizzle: "Light drizzle",
  rain: "Rain",
  heavy_rain: "Heavy rain",
  thunder: "Thunderstorm",
};

/** Baseline weather-driven exposure before user sensitivity is applied. */
export function baseVector(s: HourSample): ExposureVector {
  return {
    // 4 mm/h is treated as "soaked", 80% probability as near-certain.
    precip: Math.min(1, (s.precipMm / 4) * 0.55 + s.precipProb * 0.45),
    wind: Math.min(1, Math.max(0, (s.gustKph - 15) / 45)),
    heat: heatStress(s.feelsC),
    // Below 4 km visibility is treated as the worst case; ~1.5 km saturates.
    lowVis: Math.min(1, Math.max(0, (4 - s.visibilityKm) / 2.5)),
    thunder: s.thunderProb,
  };
}

/** Discomfort rises on both sides of a comfortable band. */
function heatStress(feelsC: number): number {
  if (feelsC >= 32) return Math.min(1, (feelsC - 32) / 12);
  if (feelsC <= 12) return Math.min(1, (12 - feelsC) / 14);
  return 0;
}

/* --------------------------------------------------- CODE → WeatherState */

/** The six renderable states. Night is time-derived, so a clear sky after
 *  sunset renders as "night" rather than "sunny". */
export function deriveState(code: WxCode, isDay: boolean): WeatherState {
  if (code === "thunder") return "thunderstorm";
  if (code === "fog") return "fog";
  if (code === "drizzle" || code === "rain" || code === "heavy_rain") return "rain";
  if (!isDay) return "night";
  if (code === "cloudy") return "cloudy";
  return "sunny";
}

export const STATE_LABEL: Record<WeatherState, string> = {
  sunny: "Sunny",
  cloudy: "Cloudy",
  rain: "Rain",
  thunderstorm: "Thunderstorm",
  fog: "Fog",
  night: "Clear night",
};
