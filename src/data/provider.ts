import type { DataSource, GeoLocation, NormalizedForecast } from "../domain/weather";

export interface WeatherProvider {
  id: DataSource;
  label: string;
  /** True when the provider can serve the live observation. */
  live: boolean;
  getForecast(location: GeoLocation, at: number): Promise<NormalizedForecast>;
}
