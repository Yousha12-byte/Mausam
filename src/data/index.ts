import type { GeoLocation, NormalizedForecast } from "../domain/weather";
import type { WeatherProvider } from "./provider";
import { mockProvider } from "./mock";
import { openMeteoProvider } from "./openmeteo";
import { imdProvider } from "./imd";

export type { WeatherProvider } from "./provider";
export { SCENARIOS, DEFAULT_SCENARIO } from "./scenarios";
export { setActiveScenario, activeScenario, mockProvider } from "./mock";

export const PROVIDERS: Record<string, WeatherProvider> = {
  "open-meteo": openMeteoProvider,
  mock: mockProvider,
  imd: imdProvider,
};

export interface LiveFetchResult {
  /** Always a real observation. Never generated. */
  forecast: NormalizedForecast;
}

/**
 * Live fetch only. This function has no fallback branch on purpose: the
 * previous `loadForecast(location, at, preferLive)` shape took a boolean where
 * `false` silently returned mock data, so a caller could ask for "not live"
 * and still end up with generated numbers wearing a live label. Callers now
 * handle failure explicitly via try/catch and decide between the cache and the
 * simulated fallback themselves, which is the only place that decision is
 * actually meaningful.
 */
export async function loadLiveForecast(location: GeoLocation, at: number): Promise<LiveFetchResult> {
  const forecast = await openMeteoProvider.getForecast(location, at);
  if (forecast.hourly.length === 0) throw new Error("Empty forecast");
  return { forecast };
}

/** Deterministic generated data. Never touches the network, never claims to be live. */
export async function loadDemoForecast(location: GeoLocation, at: number): Promise<NormalizedForecast> {
  return mockProvider.getForecast(location, at);
}
