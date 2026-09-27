import type { NormalizedForecast } from "../domain/weather";
import type { WeatherProvider } from "./provider";

/**
 * India Meteorological Department adapter — interface only.
 *
 * IMD publishes district-level forecasts and warnings, but access requires a
 * registered key and the endpoints are not yet mapped here. This stub exists so
 * that IMD can be dropped in later without touching any calling code. Until a
 * real integration ships, this provider reports itself unavailable and the
 * application falls back to the simulated provider.
 *
 * No data shown in this application currently originates from IMD.
 */
export const imdProvider: WeatherProvider = {
  id: "imd",
  label: "IMD (not connected)",
  live: false,
  async getForecast(): Promise<NormalizedForecast> {
    throw new Error("IMD integration not available");
  },
};
