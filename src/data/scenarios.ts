import type { HourSample, WxCode } from "../domain/weather";
import { dayOfYear, sunriseSunset, sunPosition } from "../domain/solar";

/** India Standard Time — fallback when no timezone is available. */
export const IST_OFFSET_MIN = 330;

/* Fields a scenario controls; temperature and daylight are derived physically. */
type Fields = Omit<
  HourSample,
  "t" | "hour" | "tempC" | "feelsC" | "isDay"
>;

export interface ScenarioSpec {
  id: string;
  label: string;
  blurb: string;
  /** Daily mean temperature, °C. */
  baseTemp: number;
  /** Diurnal amplitude, °C. */
  amp: number;
  /** Pins the demo clock so night/sunrise can be shown at any hour. */
  clockMin?: number;
  hours: (h: number) => Pick<Fields, "code"> & Partial<Fields>;
}

const CALM = { precipProb: 0, precipMm: 0, windKph: 8, gustKph: 14, cloudCover: 0.06, visibilityKm: 24, uvIndex: 8, thunderProb: 0 };

function hour(code: WxCode, over: Partial<Fields> = {}): Pick<Fields, "code"> & Partial<Fields> {
  return { code, ...over };
}

export const SCENARIOS: ScenarioSpec[] = [
  {
    id: "sunny",
    label: "Sunny",
    blurb: "Clear and warm. Nothing disrupts your day.",
    baseTemp: 31,
    amp: 4,
    // Every scenario pins its clock so the button, the sky and the decision
    // engine always agree, whatever time the demo is actually run.
    clockMin: 15 * 60,
    hours: (h) =>
      h >= 10 && h <= 16
        ? hour("clear", { uvIndex: 11, cloudCover: 0.04 })
        : h > 6 && h < 10
          ? hour("clear", { uvIndex: 7 })
          : hour("clear", CALM),
  },
  {
    id: "cloudy",
    label: "Cloudy",
    blurb: "Flat grey overcast, dry throughout.",
    clockMin: 10 * 60,
    baseTemp: 28,
    amp: 2.5,
    hours: (h) =>
      h >= 6 && h <= 19
        ? hour("cloudy", { cloudCover: 0.88, uvIndex: 3, windKph: 13, gustKph: 22, visibilityKm: 16 })
        : hour("cloudy", { cloudCover: 0.6, uvIndex: 0, windKph: 10, gustKph: 16, visibilityKm: 18 }),
  },
  {
    id: "rain",
    label: "Rain",
    blurb: "Monsoon rain building from 4 PM through the evening.",
    baseTemp: 27,
    amp: 2.5,
    // The interesting hours are the commute, so pin the clock just before it.
    // Without this the scenario degrades to "all clear" whenever the demo is
    // run in the evening, when the 17:30 routine has already passed.
    clockMin: 16 * 60 + 20,
    hours: (h) => {
      if (h < 11) return hour("partly", { cloudCover: 0.45, uvIndex: 5 });
      if (h === 11) return hour("cloudy", { cloudCover: 0.7, precipProb: 0.15, visibilityKm: 18 });
      if (h === 12) return hour("cloudy", { cloudCover: 0.8, precipProb: 0.15, visibilityKm: 15 });
      if (h === 13) return hour("cloudy", { cloudCover: 0.85, precipProb: 0.1, visibilityKm: 13 });
      if (h === 14) return hour("cloudy", { cloudCover: 0.88, precipProb: 0.1, visibilityKm: 12 });
      if (h === 15) return hour("cloudy", { cloudCover: 0.9, precipProb: 0.2, visibilityKm: 11, windKph: 15, gustKph: 24 });
      if (h === 16) return hour("rain", { cloudCover: 0.92, precipProb: 0.35, precipMm: 0.3, visibilityKm: 9, windKph: 16, gustKph: 28 });
      if (h === 17) return hour("rain", { cloudCover: 0.94, precipProb: 0.6, precipMm: 1.6, visibilityKm: 7, windKph: 18, gustKph: 32 });
      if (h === 18) return hour("rain", { cloudCover: 0.94, precipProb: 0.9, precipMm: 5.6, visibilityKm: 4.5, windKph: 22, gustKph: 38 });
      if (h === 19) return hour("rain", { cloudCover: 0.9, precipProb: 0.8, precipMm: 3.2, visibilityKm: 6, windKph: 19, gustKph: 30 });
      if (h === 20) return hour("cloudy", { cloudCover: 0.85, precipProb: 0.45, precipMm: 0.5, visibilityKm: 9 });
      if (h === 21) return hour("cloudy", { cloudCover: 0.7, precipProb: 0.25, visibilityKm: 13 });
      return hour("cloudy", { cloudCover: 0.5, precipProb: 0.1, visibilityKm: 17 });
    },
  },
  {
    id: "thunderstorm",
    label: "Thunderstorm",
    blurb: "Severe storm with lightning and damaging gusts after 3 PM.",
    baseTemp: 26,
    amp: 2,
    // The storm peaks at 5 PM and the commute starts at 5:30 PM, so pinning
    // just before the peak puts a real thunderstorm on screen, still ahead in
    // the forecast, with the user's journey about to walk into it.
    clockMin: 17 * 60 + 10,
    hours: (h) => {
      if (h < 12) return hour("partly", { cloudCover: 0.5, uvIndex: 5 });
      if (h === 12) return hour("cloudy", { cloudCover: 0.75, precipProb: 0.3 });
      if (h === 13) return hour("cloudy", { cloudCover: 0.85, precipProb: 0.5, thunderProb: 0.15, gustKph: 34 });
      if (h === 14) return hour("rain", { cloudCover: 0.92, precipProb: 0.75, precipMm: 3.4, thunderProb: 0.45, windKph: 34, gustKph: 48, visibilityKm: 5 });
      if (h === 15) return hour("heavy_rain", { cloudCover: 0.96, precipProb: 0.88, precipMm: 8.5, thunderProb: 0.7, windKph: 42, gustKph: 58, visibilityKm: 3 });
      if (h === 16) return hour("heavy_rain", { cloudCover: 0.98, precipProb: 0.94, precipMm: 14, thunderProb: 0.9, windKph: 48, gustKph: 66, visibilityKm: 2 });
      if (h === 17) return hour("thunder", { cloudCover: 1, precipProb: 1, precipMm: 19, thunderProb: 1, windKph: 54, gustKph: 74, visibilityKm: 1.4 });
      if (h === 18) return hour("thunder", { cloudCover: 1, precipProb: 0.96, precipMm: 15, thunderProb: 0.92, windKph: 50, gustKph: 68, visibilityKm: 1.8 });
      if (h === 19) return hour("heavy_rain", { cloudCover: 0.96, precipProb: 0.82, precipMm: 7.2, thunderProb: 0.5, windKph: 38, gustKph: 52, visibilityKm: 3.5 });
      if (h === 20) return hour("rain", { cloudCover: 0.9, precipProb: 0.55, precipMm: 3, thunderProb: 0.15, windKph: 28, gustKph: 38, visibilityKm: 6 });
      if (h === 21) return hour("rain", { cloudCover: 0.85, precipProb: 0.3, precipMm: 1, windKph: 22, gustKph: 30, visibilityKm: 9 });
      return hour("cloudy", { cloudCover: 0.7, precipProb: 0.15, visibilityKm: 13 });
    },
  },
  {
    id: "fog",
    label: "Fog",
    blurb: "Dense radiation fog at dawn, thinning towards mid-morning.",
    baseTemp: 24,
    amp: 3,
    // Fog is a dawn phenomenon; pin the clock so the scenario always shows fog
    // and the 8:15 AM routine conflict, whatever time the demo is running.
    clockMin: 6 * 60 + 30,
    hours: (h) => {
      if (h <= 5) return hour("fog", { cloudCover: 0.5, visibilityKm: 0.2, windKph: 4, gustKph: 7 });
      if (h === 6) return hour("fog", { cloudCover: 0.55, visibilityKm: 0.3, windKph: 4, gustKph: 7 });
      if (h === 7) return hour("fog", { cloudCover: 0.6, visibilityKm: 0.5, windKph: 5, gustKph: 8 });
      if (h === 8) return hour("fog", { cloudCover: 0.62, visibilityKm: 1.1, windKph: 6, gustKph: 10 });
      if (h === 9) return hour("fog", { cloudCover: 0.58, visibilityKm: 3.5, windKph: 7, gustKph: 12 });
      if (h === 10) return hour("partly", { cloudCover: 0.4, visibilityKm: 9, windKph: 8, gustKph: 13 });
      if (h <= 16) return hour("partly", { cloudCover: 0.3, uvIndex: 7, visibilityKm: 20, windKph: 9, gustKph: 15 });
      if (h <= 19) return hour("partly", { cloudCover: 0.35, visibilityKm: 18 });
      return hour("cloudy", { cloudCover: 0.5, visibilityKm: 14, windKph: 8 });
    },
  },
  {
    id: "night",
    label: "Clear night",
    blurb: "Clear skies after sunset — stars out, cool and calm.",
    baseTemp: 25,
    amp: 4,
    clockMin: 21 * 60 + 40,
    hours: () => hour("clear", { ...CALM, uvIndex: 0, cloudCover: 0.03, visibilityKm: 25 }),
  },
];

export const DEFAULT_SCENARIO = SCENARIOS[0]!;

/* ---------------------------------------------------------------- BUILDING */

/** Diurnal temperature curve, peaking at 15:00. */
function diurnalTemp(base: number, amp: number, h: number): number {
  return base + amp * Math.cos(((h - 15) * Math.PI) / 12);
}

export function buildScenarioForecast(
  spec: ScenarioSpec,
  lat: number,
  tzOffsetMin: number,
  at: number,
): HourSample[] {
  const day = dayOfYear(new Date(at));
  const utcMidnight = Math.floor(at / 86400000) * 86400000;
  const localMidnight = utcMidnight - tzOffsetMin * 60000;

  return Array.from({ length: 24 }, (_, h) => {
    const f = spec.hours(h);
    const tempC = diurnalTemp(spec.baseTemp, spec.amp, h);
    const { elevation } = sunPosition(lat, day, h - 12);
    // Sun above -6° counts as day; that keeps civil twilight lit.
    const isDay = elevation > -6;

    return {
      t: localMidnight + h * 3600_000,
      hour: h,
      tempC,
      feelsC: tempC + ((f.precipMm ?? 0) > 0 ? -1.2 : 0.6),
      code: f.code,
      isDay,
      precipMm: f.precipMm ?? 0,
      precipProb: f.precipProb ?? 0,
      windKph: f.windKph ?? 8,
      gustKph: f.gustKph ?? 14,
      cloudCover: f.cloudCover ?? 0.2,
      visibilityKm: f.visibilityKm ?? 20,
      uvIndex: isDay ? (f.uvIndex ?? 0) : 0,
      thunderProb: f.thunderProb ?? 0,
    };
  });
}

export function scenarioDayTimes(lat: number, lon: number, at: number) {
  return sunriseSunset(lat, dayOfYear(new Date(at)), lon);
}
