import type { HourSample, NormalizedForecast, WeatherState } from "../domain/weather";
import { deriveState } from "../domain/taxonomy";
import { dayOfYear, lunarPhase, moonPosition, solarNoonMinutes, sunPosition } from "../domain/solar";
import { sampleAt } from "../domain/decision";
import { clamp } from "../lib/utils";

export interface AtmosphereState {
  state: WeatherState;
  sunElevation: number;
  sunAzimuth: number;
  moonElevation: number;
  moonAzimuth: number;
  moonPhase: number;
  isDay: boolean;
  /** 0..1 */
  cloudCover: number;
  /** 0..1 — drives droplet count, speed, streak length and opacity. */
  precipIntensity: number;
  windKph: number;
  visibilityKm: number;
  thunderProb: number;
  tempC: number;
  isDaylight: boolean;
}

function solarHourAngle(lon: number, nowMin: number): number {
  return (nowMin - solarNoonMinutes(lon)) / 60;
}

/**
 * Pure derivation: everything the visual and audio layers need, with no
 * knowledge of React, canvas, or audio. Testable in isolation.
 */
export function deriveAtmosphere(
  forecast: NormalizedForecast,
  nowMin: number,
): AtmosphereState {
  const s: HourSample = sampleAt(forecast, nowMin);
  const { lat, lon } = forecast.location;
  const day = dayOfYear(new Date(forecast.fetchedAt));
  const H = solarHourAngle(lon, nowMin);

  const sun = sunPosition(lat, day, H);
  const moon = moonPosition(lat, day, H, new Date(forecast.fetchedAt));

  // Distinguish "is the sky light" from "is the sun technically up".
  const isDaylight = sun.elevation > -6;

  // 0.2 mm/h is a drizzle, 8 mm/h is a downpour.
  const precipIntensity = clamp(s.precipMm / 8 + s.precipProb * 0.25);

  return {
    state: deriveState(s.code, isDaylight),
    sunElevation: sun.elevation,
    sunAzimuth: sun.azimuth,
    moonElevation: moon.elevation,
    moonAzimuth: moon.azimuth,
    moonPhase: lunarPhase(new Date(forecast.fetchedAt)),
    isDay: s.isDay,
    cloudCover: clamp(s.cloudCover),
    precipIntensity,
    windKph: s.windKph,
    visibilityKm: s.visibilityKm,
    thunderProb: s.thunderProb,
    tempC: s.tempC,
    isDaylight,
  };
}

/* ------------------------------------------------------------ runtime store */

/**
 * Mutable holder shared between the reconciler and the render loops. The
 * canvases read this by reference inside rAF and never re-render React, so a
 * forecast update costs one object write rather than a tree re-render.
 */
export const live: { current: AtmosphereState | null } = { current: null };

/** Coarse-pointer and low-core devices get a much smaller particle budget. */
export function qualityTier(): "high" | "low" {
  if (typeof navigator === "undefined") return "high";
  const coarse = !window.matchMedia("(pointer: fine)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  return coarse || cores <= 4 ? "low" : "high";
}

export const DPR_CAP = { high: 2, low: 1.25 } as const;
